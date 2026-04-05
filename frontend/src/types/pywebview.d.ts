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

interface Student {
  id: number
  student_id: string
  student_name: string
  card_uid: string
  created_at: string
  updated_at: string
}

interface HubConfig {
  url: string
  api_key: string
}

interface Member {
  id: number
  discord_id: string
  username: string
  display_name: string
  avatar_url: string
  real_name: string
  student_id: string
  synced_at: string
}

interface PyWebViewApi {
  get_students(): Promise<Student[]>
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
  get_hub_config(): Promise<HubConfig>
  save_hub_config(url: string, api_key: string): Promise<{ status: string }>
  sync_members(): Promise<{ status: string; count?: number; message?: string }>
  get_members(): Promise<Member[]>
  sync_attendances(session_id: number): Promise<{ status: string; count?: number; message?: string }>
  export_csv(session_id: number): Promise<
    | { status: 'saved'; path: string }
    | { status: 'cancelled' }
    | { status: 'error'; message: string }
  >
}

interface Window {
  pywebview?: {
    api: PyWebViewApi
  }
}
