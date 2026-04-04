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
      const api = window.pywebview?.api
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
            onKeyDown={(e) => e.key === 'Enter' && handleCreateSession()}
          />
          <button onClick={handleCreateSession} disabled={!newSessionName.trim()}>
            新規作成
          </button>
        </div>

        {sessions.length > 0 && (
          <div className="session-list">
            <h2>過去のセッション</h2>
            {sessions.map((s) => (
              <button
                key={s.id}
                className="session-item"
                onClick={() => handleSelectSession(s)}
              >
                <span className="session-name">{s.name}</span>
                <span className="session-date">{s.created_at}</span>
              </button>
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
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
