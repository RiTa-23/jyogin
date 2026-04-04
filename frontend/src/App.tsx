import { useEffect, useState } from 'react'
import './App.css'

type NfcStatus = 'waiting' | 'ready' | 'error'

interface NfcReadEvent {
  card_uid: string
  student_id: string | null
  student_name: string | null
}

interface ApiResultEvent {
  action?: string
  user?: { display_name?: string }
  error?: string
}

function App() {
  const [status, setStatus] = useState<NfcStatus>('waiting')
  const [lastRead, setLastRead] = useState<NfcReadEvent | null>(null)
  const [lastResult, setLastResult] = useState<ApiResultEvent | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const onStatus = (e: CustomEvent) => {
      const d = e.detail
      setStatus(d.status)
      if (d.message) setErrorMsg(d.message)
    }

    const onRead = (e: CustomEvent) => {
      setLastRead(e.detail)
      setLastResult(null)
    }

    const onApiResult = (e: CustomEvent) => {
      setLastResult(e.detail)
    }

    window.addEventListener('nfc:status', onStatus as EventListener)
    window.addEventListener('nfc:read', onRead as EventListener)
    window.addEventListener('nfc:api-result', onApiResult as EventListener)

    return () => {
      window.removeEventListener('nfc:status', onStatus as EventListener)
      window.removeEventListener('nfc:read', onRead as EventListener)
      window.removeEventListener('nfc:api-result', onApiResult as EventListener)
    }
  }, [])

  return (
    <div className="app">
      <h1>NFC 入退室管理</h1>

      <div className={`status ${status}`}>
        {status === 'waiting' && 'NFC リーダー接続待ち...'}
        {status === 'ready' && 'カードをかざしてください'}
        {status === 'error' && `エラー: ${errorMsg}`}
      </div>

      {lastRead && (
        <div className="card-info">
          <p className="uid">UID: {lastRead.card_uid}</p>
          {lastRead.student_id && (
            <>
              <p className="student-id">学籍番号: {lastRead.student_id}</p>
              <p className="student-name">{lastRead.student_name}</p>
            </>
          )}
        </div>
      )}

      {lastResult && (
        <div className={`result ${lastResult.error ? 'error' : 'success'}`}>
          {lastResult.error ? (
            <p>エラー: {lastResult.error}</p>
          ) : (
            <p>
              {lastResult.action === 'check_in' ? '入室' : '退室'}:{' '}
              {lastResult.user?.display_name}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default App
