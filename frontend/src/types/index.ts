export interface ActionItem {
  id: number
  title: string
  description: string | null
  event_date: string | null
  prep_start_date: string | null
  lead_time_days: number | null
  is_short_notice: boolean
  short_notice_note: string | null
  completed: boolean
  source_type: 'email' | 'calendar' | 'combined' | 'manual'
  source_email_id: number | null
  source_event_id: number | null
  event_group_id: number | null
  created_at: string
  // Broad category. Homework items: 'homework_spelling' | 'homework_poem' | 'homework_special_project'
  // Other: 'permission_slip' | 'payment' | 'attendance' | 'bring_item' | null
  item_type: string | null
}

export interface EventGroup {
  id: number
  display_name: string
  event_date: string | null
  created_at: string
  updated_at: string
  items: ActionItem[]
  all_completed: boolean
  has_short_notice: boolean
  earliest_prep_start_date: string | null
}

export interface EmailKeyPoints {
  summary: string
  dates: { label: string; date: string | null }[]
  requirements: string[]
}

export interface PDFLearningArea {
  subject: string
  what_we_learned: string
  coming_up: string | null
}

export interface PDFAnalysis {
  title: string
  week_of: string | null
  summary: string
  learning_areas: PDFLearningArea[]
  upcoming_events: { label: string; date: string | null }[]
  reminders: string[]
  poem_text?: string | null
}

export interface PDFEntry {
  filename: string
  analysis: PDFAnalysis | null
}

export interface PSAttachments {
  feed_url: string
  feed_id?: number
  attachment_count: number
  thumbnail_urls: string[]
  post_text: string
  pdf_filenames?: string[]       // PDF filenames found on the PS page
  pdf_analyses?: PDFEntry[]      // Claude analyses, populated after PDF fetch
  error?: string
}

export interface Email {
  id: number
  gmail_message_id: string
  sender: string | null
  subject: string | null
  body_plain: string | null
  key_points: string | null       // Raw JSON string from backend
  ps_attachments: string | null   // Raw JSON string → PSAttachments
  audience: string | null         // Extracted ParentSquare groups, e.g. "KHe,KH"
  received_at: string | null
  analyzed: boolean
  created_at: string
  action_items: ActionItem[]
}

export interface CalendarEvent {
  id: number
  google_event_id: string
  title: string | null
  description: string | null
  start_datetime: string | null
  end_datetime: string | null
  location: string | null
  analyzed: boolean
  created_at: string
}

export interface AppNotification {
  id: number
  action_item_id: number | null
  message: string
  status: 'pending' | 'shown' | 'dismissed'
  created_at: string
}

export interface AuthStatus {
  connected: boolean
  email: string | null
  scopes: string[]
}

export interface CalendarInfo {
  id: string
  name: string
  primary: boolean
  color: string
}

export interface UserSettings {
  school_sender_domain: string
  school_gmail_labels: string
  poll_interval_hours: string
  reminder_channel: string
  reminder_email_address: string
  short_notice_threshold_days: string
  selected_calendar_id: string
  child_class_code: string     // e.g. "KHe"
  child_grade_level: string    // e.g. "Kindergarten"
  ps_session_cookie: string    // ParentSquare _ps_session cookie value
}

export interface ScanResult {
  emails_fetched: number
  action_items_created: number
  message: string
}

export interface ScanStatus {
  scanning: boolean
  last_scan_at: string | null
}
