interface Session {
  id: number
  name: string
  created_at: string
}

interface Attendance {
  id: number
  session_id: number
  student_id: string
  student_name: string
  card_uid: string
  scanned_at: string
}

interface PyWebViewApi {
  create_session(name: string): Promise<Session>
  get_sessions(): Promise<Session[]>
  get_attendances(session_id: number): Promise<Attendance[]>
  record_attendance(
    session_id: number,
    student_id: string,
    student_name: string,
    card_uid: string
  ): Promise<{ status: 'recorded' | 'duplicate' }>
}

interface Window {
  pywebview?: {
    api: PyWebViewApi
  }
}
