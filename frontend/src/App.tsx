import { useEffect, useState, useRef } from 'react'
import './App.css'

type NfcStatus = 'waiting' | 'ready' | 'reading' | 'done' | 'error'
type Page = 'session-select' | 'scanning' | 'students' | 'members' | 'hub-settings'

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

  const [students, setStudents] = useState<Student[]>([])

  const [hubUrl, setHubUrl] = useState('')
  const [hubApiKey, setHubApiKey] = useState('')
  const [hubMembers, setHubMembers] = useState<Member[]>([])
  const [hubMsg, setHubMsg] = useState('')
  const [hubLoading, setHubLoading] = useState(false)

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

    const onNavigate = async (e: CustomEvent) => {
      const targetPage = e.detail.page as Page
      setPage(targetPage)
      if (targetPage === 'students') {
        const api = window.pywebview?.api
        if (api) {
          const list = await api.get_students()
          setStudents(list)
        }
      }
      if (targetPage === 'members') {
        const api = window.pywebview?.api
        if (api) {
          const members = await api.get_members()
          setHubMembers(members)
        }
      }
      if (targetPage === 'hub-settings') {
        const api = window.pywebview?.api
        if (api) {
          const config = await api.get_hub_config()
          setHubUrl(config.url)
          setHubApiKey(config.api_key)
        }
      }
    }

    window.addEventListener('nfc:status', onStatus as unknown as EventListener)
    window.addEventListener('nfc:read', onRead as unknown as EventListener)
    window.addEventListener('navigate', onNavigate as unknown as EventListener)

    return () => {
      clearTimeout(doneTimer)
      window.removeEventListener('nfc:status', onStatus as unknown as EventListener)
      window.removeEventListener('nfc:read', onRead as unknown as EventListener)
      window.removeEventListener('navigate', onNavigate as unknown as EventListener)
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

  const handleSyncMembers = async () => {
    const api = window.pywebview?.api
    if (!api) return
    setHubLoading(true)
    setHubMsg('')
    const result = await api.sync_members()
    if (result.status === 'synced') {
      setHubMsg(`${result.count}名の部員データを同期しました`)
      const members = await api.get_members()
      setHubMembers(members)
    } else {
      setHubMsg(`エラー: ${result.message}`)
    }
    setHubLoading(false)
  }

  if (page === 'hub-settings') {
    const handleSaveConfig = async () => {
      const api = window.pywebview?.api
      if (!api) return
      await api.save_hub_config(hubUrl, hubApiKey)
      setHubMsg('設定を保存しました')
    }

    return (
      <div className="app">
        <header className="scan-header">
          <button className="back-btn" onClick={handleBack}>← 戻る</button>
          <h1>Hub連携設定</h1>
        </header>

        <div className="hub-settings">
          <div className="hub-field">
            <label>JyoginHub URL</label>
            <input
              type="text"
              placeholder="https://example.com"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
            />
          </div>
          <div className="hub-field">
            <label>APIキー</label>
            <input
              type="password"
              placeholder="jyogin_..."
              value={hubApiKey}
              onChange={(e) => setHubApiKey(e.target.value)}
            />
          </div>
          <div className="hub-actions">
            <button onClick={handleSaveConfig}>設定を保存</button>
          </div>
          {hubMsg && <p className="hub-msg">{hubMsg}</p>}
        </div>
      </div>
    )
  }

  if (page === 'members') {
    return (
      <div className="app">
        <header className="scan-header">
          <button className="back-btn" onClick={handleBack}>← 戻る</button>
          <h1>部員一覧</h1>
        </header>

        <div className="students-list">
          <div className="hub-actions">
            <button onClick={handleSyncMembers} disabled={hubLoading}>
              {hubLoading ? '同期中...' : '部員データを同期'}
            </button>
          </div>
          {hubMsg && <p className="hub-msg">{hubMsg}</p>}
          <p className="students-count">{hubMembers.length}名</p>
          <table className="students-table">
            <thead>
              <tr>
                <th></th>
                <th>Discord名</th>
                <th>本名</th>
                <th>学籍番号</th>
              </tr>
            </thead>
            <tbody>
              {hubMembers.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%', verticalAlign: 'middle' }} />
                    ) : (
                      <span style={{ display: 'inline-block', width: 24, height: 24, borderRadius: '50%', background: '#dee2e6', textAlign: 'center', lineHeight: '24px', fontSize: 12 }}>?</span>
                    )}
                  </td>
                  <td>{m.display_name || m.username || '-'}</td>
                  <td>{m.real_name || '-'}</td>
                  <td className="mono">{m.student_id || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hubMembers.length === 0 && (
            <p className="empty-msg">部員データがありません。Hub連携設定から同期してください。</p>
          )}
        </div>
      </div>
    )
  }

  if (page === 'students') {
    return (
      <div className="app">
        <header className="scan-header">
          <button className="back-btn" onClick={handleBack}>← 戻る</button>
          <h1>学生証一覧</h1>
        </header>

        <div className="students-list">
          <p className="students-count">登録数: {students.length}名</p>
          <table className="students-table">
            <thead>
              <tr>
                <th>学籍番号</th>
                <th>氏名</th>
                <th>登録日</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.student_id}</td>
                  <td>{s.student_name}</td>
                  <td className="date">{s.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {students.length === 0 && (
            <p className="empty-msg">まだ学生が登録されていません</p>
          )}
        </div>
      </div>
    )
  }

  if (page === 'session-select') {
    return (
      <div className="app">
        <div className="app-title">
          <img src="/JyogiN.png" alt="JyogiN" className="app-logo" />
          <h1>Jyogin</h1>
          <p className="app-desc">NFC 出席確認</p>
        </div>

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
            try {
              const result = await api.export_csv(activeSession.id)
              if (result.status === 'error') {
                alert(`エクスポート失敗: ${result.message}`)
              }
            } catch (e) {
              alert(`エクスポート失敗: ${e}`)
            }
          }}
        >
          CSV出力
        </button>
        <button
          className="export-btn"
          onClick={async () => {
            const api = window.pywebview?.api
            if (!api || !activeSession) return
            const result = await api.sync_attendances(activeSession.id)
            if (result.status === 'synced') {
              alert(`${result.count}件の出席データをHubに同期しました`)
            } else {
              alert(`同期失敗: ${result.message}`)
            }
          }}
        >
          Hub同期
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
