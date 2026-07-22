export type Profile = {
  id: string
  display_name: string
}

export type Workout = {
  id: string
  user_id: string
  display_name: string
  workout_date: string
  title: string
  notes: string | null
  duration_minutes: number
  created_at: string
}
