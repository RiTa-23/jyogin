import { useEffect, useState, useRef } from 'react'
import './App.css'

type NfcStatus = 'waiting' | 'ready' | 'reading' | 'done' | 'error'
type Page = 'session-select' | 'scanning'

interface NfcReadEvent {
  card_uid: string
  student_id: string | null
  student_name: string | null
}

const STATUS_CONFIG: Record<NfcStatus, { label: string; icon: string }> = {
  waiting: { label: 'NFC リーダー接続待ち...', icon: '🔌' },
  ready: { label: 'カードをかざしてください', icon: '📡' },
  reading: { label: '読み取り中...', icon: '⏳' },
  done: { label: '読み取り完了', icon: '✅' },
  error: { label: 'エラー', icon: '❌' },
}

function NoteInput({ attendance }: { attendance: Attendance }) {
  const [value, setValue] = useState(attendance.note ?? '')
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const save = (note: string) => {
    const api = window.pywebview?.api
    if (!api || note === (attendance.note ?? '')) return
    api.update_note(attendance.id, note)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setValue(v)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => save(v), 500)
  }

  return (
    <input
      className="attendance-note"
      type="text"
      placeholder="備考"
      value={value}
      onChange={handleChange}
    />
  )
}

function App() {
  const [page, setPage] = useState<Page>('session-select')
  const [sessions, setSessions] = useState<Session[]>([])
  const [newSessionName, setNewSessionName] = useState('')
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [attendances, setAttendances] = useState<Attendance[]>([])

  const [status, setStatus] = useState<NfcStatus>('waiting')
  const [lastRead, setLastRead] = useState<NfcReadEvent | null>(null)
  const [errorMsg, setErrorMsg] = useState('')


  const activeSessionRef = useRef(activeSession)
  useEffect(() => {
    activeSessionRef.current = activeSession
  }, [activeSession])

  // セッション一覧を取得
  useEffect(() => {
    const load = async () => {
      // pywebview.api が準備されるまで待つ
      let api = window.pywebview?.api
      if (!api) {
        await new Promise<void>((resolve) => {
          window.addEventListener('pywebviewready', () => resolve(), { once: true })
        })
        api = window.pywebview?.api
      }
      if (!api) return
      const list = await api.get_sessions()
      setSessions(list)
    }
    load()
  }, [page])

  // NFC イベント
  useEffect(() => {
    let doneTimer: ReturnType<typeof setTimeout>

    const onStatus = (e: CustomEvent) => {
      const d = e.detail
      if (d.message) setErrorMsg(d.message)
      setStatus(d.status)
      if (d.status === 'done') {
        doneTimer = setTimeout(() => {
          setStatus('ready')
          setLastRead(null)
        }, 3000)
      }
    }

    const onRead = async (e: CustomEvent) => {
      const data: NfcReadEvent = e.detail
      setLastRead(data)

      const session = activeSessionRef.current
      if (!session || !data.student_id) return

      const api = window.pywebview?.api
      if (!api) return

      await api.record_attendance(
        session.id,
        data.student_id,
        data.student_name ?? '',
        data.card_uid
      )

      const list = await api.get_attendances(session.id)
      setAttendances(list)
    }

    window.addEventListener('nfc:status', onStatus as unknown as EventListener)
    window.addEventListener('nfc:read', onRead as unknown as EventListener)

    return () => {
      clearTimeout(doneTimer)
      window.removeEventListener('nfc:status', onStatus as unknown as EventListener)
      window.removeEventListener('nfc:read', onRead as unknown as EventListener)
    }
  }, [])

  const handleCreateSession = async () => {
    const name = newSessionName.trim()
    if (!name) return
    const api = window.pywebview?.api
    if (!api) return
    const session = await api.create_session(name)
    setNewSessionName('')
    setActiveSession(session)
    setAttendances([])
    setLastRead(null)
    setPage('scanning')
  }

  const handleSelectSession = async (session: Session) => {
    const api = window.pywebview?.api
    if (!api) return
    setActiveSession(session)
    const list = await api.get_attendances(session.id)
    setAttendances(list)
    setLastRead(null)
    setPage('scanning')
  }

  const handleDeleteSession = async (e: React.MouseEvent, session: Session) => {
    e.stopPropagation()
    if (!confirm(`「${session.name}」を削除しますか？`)) return
    const api = window.pywebview?.api
    if (!api) return
    await api.delete_session(session.id)
    setSessions((prev) => prev.filter((s) => s.id !== session.id))
  }

  const handleBack = () => {
    setActiveSession(null)
    setAttendances([])
    setLastRead(null)
    setPage('session-select')
  }

  if (page === 'session-select') {
    return (
      <div className="app">
        <h1>NFC 出席確認</h1>

        <div className="session-create">
          <input
            type="text"
            placeholder="セッション名（例：第1回部会）"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
          />
          <button onClick={handleCreateSession} disabled={!newSessionName.trim()}>
            新規作成
          </button>
        </div>

        {sessions.length > 0 && (
          <div className="session-list">
            <h2>過去のセッション</h2>
            {sessions.map((s) => (
              <div key={s.id} className="session-item">
                <button
                  className="session-item-main"
                  onClick={() => handleSelectSession(s)}
                >
                  <span className="session-name">{s.name}</span>
                  <span className="session-date">{s.created_at}</span>
                </button>
                <button
                  className="session-delete"
                  onClick={(e) => handleDeleteSession(e, s)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const { label, icon } = STATUS_CONFIG[status]

  return (
    <div className="app">
      <header className="scan-header">
        <button className="back-btn" onClick={handleBack}>← 戻る</button>
        <h1>{activeSession?.name}</h1>
        <button
          className="export-btn"
          onClick={async () => {
            const api = window.pywebview?.api
            if (!api || !activeSession) return
            await api.export_csv(activeSession.id)
          }}
        >
          CSV出力
        </button>
      </header>

      <div className={`status ${status}`}>
        <span className="status-icon">{icon}</span>
        <span>{status === 'error' ? `${label}: ${errorMsg}` : label}</span>
      </div>

      {lastRead && lastRead.student_id && (
        <div className={`card-info ${status === 'done' ? 'highlight' : ''}`}>
          <p className="student-id">学籍番号: {lastRead.student_id}</p>
          <p className="student-name">{lastRead.student_name}</p>
        </div>
      )}

      <div className="attendance-list">
        <h2>出席者（{attendances.length}名）</h2>
        {attendances.map((a) => (
          <div key={a.id} className="attendance-item">
            <span className="attendance-id">{a.student_id}</span>
            <span className="attendance-name">{a.student_name}</span>
            <span className="attendance-time">{a.scanned_at?.slice(11, 16)}</span>
            <NoteInput attendance={a} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
