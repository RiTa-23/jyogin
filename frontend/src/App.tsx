import { useEffect, useState } from 'react'
import './App.css'

type NfcStatus = 'waiting' | 'ready' | 'reading' | 'done' | 'error'

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
  const [status, setStatus] = useState<NfcStatus>('waiting')
  const [lastRead, setLastRead] = useState<NfcReadEvent | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let doneTimer: ReturnType<typeof setTimeout>

    const onStatus = (e: CustomEvent) => {
      const d = e.detail
      if (d.message) setErrorMsg(d.message)

      setStatus(d.status)

      // done状態は3秒後にreadyに戻す
      if (d.status === 'done') {
        doneTimer = setTimeout(() => setStatus('ready'), 3000)
      }
    }

    const onRead = (e: CustomEvent) => {
      setLastRead(e.detail)
    }

    window.addEventListener('nfc:status', onStatus as EventListener)
    window.addEventListener('nfc:read', onRead as EventListener)

    return () => {
      clearTimeout(doneTimer)
      window.removeEventListener('nfc:status', onStatus as EventListener)
      window.removeEventListener('nfc:read', onRead as EventListener)
    }
  }, [])

  const { label, icon } = STATUS_CONFIG[status]

  return (
    <div className="app">
      <h1>NFC 出席確認</h1>

      <div className={`status ${status}`}>
        <span className="status-icon">{icon}</span>
        <span>{status === 'error' ? `${label}: ${errorMsg}` : label}</span>
      </div>

      {lastRead && (
        <div className={`card-info ${status === 'done' ? 'highlight' : ''}`}>
          <p className="uid">UID: {lastRead.card_uid}</p>
          {lastRead.student_id && (
            <>
              <p className="student-id">学籍番号: {lastRead.student_id}</p>
              <p className="student-name">{lastRead.student_name}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App
