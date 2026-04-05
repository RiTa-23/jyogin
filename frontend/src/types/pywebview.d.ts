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
  note: string
  scanned_at: string
}

interface PyWebViewApi {
  create_session(name: string): Promise<Session>
  get_sessions(): Promise<Session[]>
  delete_session(session_id: number): Promise<{ status: string }>
  get_attendances(session_id: number): Promise<Attendance[]>
  record_attendance(
    session_id: number,
    student_id: string,
    student_name: string,
    card_uid: string
  ): Promise<{ status: 'recorded' | 'duplicate' }>
  update_note(attendance_id: number, note: string): Promise<{ status: string }>
}

interface Window {
  pywebview?: {
    api: PyWebViewApi
  }
}
