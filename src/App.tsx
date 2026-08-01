import { zodResolver } from '@hookform/resolvers/zod'
import type { Session } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { z } from 'zod'
import { Login } from './Login'
import { supabase } from './lib/supabase'
import type { Profile, Workout } from './types'

const workoutSchema = z.object({
  title: z.string().min(2, 'Give the workout a short title.'),
  workout_date: z.string().min(1, 'Pick a date.'),
  duration_minutes: z.coerce.number().int().min(1).max(600),
  notes: z.string().max(2000).optional(),
})

const displayNameSchema = z.string().trim().min(2, 'Display name must be at least 2 characters.').max(80)

type WorkoutFormInput = z.input<typeof workoutSchema>
type WorkoutFormValues = z.output<typeof workoutSchema>

const today = toDateInput(new Date())
const currentWeekStart = weekStartForDate(new Date())

function toDateInput(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromInput(value: string) {
  return new Date(`${value}T00:00:00`)
}

function weekStartForDate(date: Date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return toDateInput(start)
}

function addDays(dateValue: string, days: number) {
  const date = dateFromInput(dateValue)
  date.setDate(date.getDate() + days)
  return toDateInput(date)
}

function weeksBetween(start: string, end: string) {
  return Math.round((dateFromInput(end).getTime() - dateFromInput(start).getTime()) / (7 * 24 * 60 * 60 * 1000))
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [isWorkoutFormOpen, setIsWorkoutFormOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
      if (!nextSession) {
        setIsWorkoutFormOpen(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <BrowserRouter>
      <Shell session={session} onOpenWorkoutForm={() => setIsWorkoutFormOpen(true)}>
        {!authReady ? (
          <StatusScreen title="Loading" message="Checking your session..." />
        ) : (
          <Routes>
            <Route
              path="/login"
              element={session ? <Navigate to="/" replace /> : <Login />}
            />
            <Route
              path="/"
              element={session ? (
                <Dashboard
                  isWorkoutFormOpen={isWorkoutFormOpen}
                  onCloseWorkoutForm={() => setIsWorkoutFormOpen(false)}
                  session={session}
                />
              ) : <Navigate to="/login" replace />}
            />
          </Routes>
        )}
      </Shell>
    </BrowserRouter>
  )
}

function Shell({
  children,
  onOpenWorkoutForm,
  session,
}: {
  children: React.ReactNode
  onOpenWorkoutForm: () => void
  session?: Session | null
}) {
  const queryClient = useQueryClient()

  const signOut = async () => {
    await supabase.auth.signOut()
    queryClient.clear()
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-3 sm:px-6 sm:py-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded bg-emerald-600 text-lg font-bold text-white">
              W
            </span>
            <div className="min-w-0">
              <p className="text-sm uppercase tracking-wide text-stone-500">Private crew</p>
              <h1 className="truncate text-xl font-semibold">Workout Notes</h1>
            </div>
          </Link>
          {session ? (
            <div className="flex shrink-0 items-center gap-2">
              <button className="button-primary md:hidden" type="button" onClick={onOpenWorkoutForm}>
                + Log
              </button>
              <button className="button-secondary" type="button" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-6">{children}</main>
    </div>
  )
}

function Dashboard({
  isWorkoutFormOpen,
  onCloseWorkoutForm,
  session,
}: {
  isWorkoutFormOpen: boolean
  onCloseWorkoutForm: () => void
  session: Session
}) {
  const queryClient = useQueryClient()
  const [workoutFormVersion, setWorkoutFormVersion] = useState(0)
  const [selectedWeekStart, setSelectedWeekStart] = useState(currentWeekStart)
  const profileQuery = useProfile(session.user.id)
  const crewProfilesQuery = useCrewProfiles(Boolean(profileQuery.data))
  const earliestWorkoutQuery = useEarliestWorkoutDate(Boolean(profileQuery.data))
  const workoutsQuery = useWorkouts(Boolean(profileQuery.data), selectedWeekStart)

  const totalMinutes = useMemo(
    () => workoutsQuery.data?.reduce((sum, workout) => sum + workout.duration_minutes, 0) ?? 0,
    [workoutsQuery.data],
  )
  const crewColumns = useMemo(
    () => createCrewColumns(crewProfilesQuery.data ?? [], workoutsQuery.data ?? []),
    [crewProfilesQuery.data, workoutsQuery.data],
  )

  const createWorkout = useMutation({
    mutationFn: async ({ displayName, ...values }: WorkoutFormValues & { displayName: string }) => {
      const { error } = await supabase.from('workouts').insert({
        display_name: displayName,
        title: values.title,
        workout_date: values.workout_date,
        duration_minutes: values.duration_minutes,
        notes: values.notes || null,
      })

      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      setWorkoutFormVersion((version) => version + 1)
      void queryClient.invalidateQueries({ queryKey: ['workouts'] })
      void queryClient.invalidateQueries({ queryKey: ['earliest-workout-date'] })
    },
  })

  const updateWorkout = useMutation({
    mutationFn: async ({ id, ...values }: WorkoutFormValues & { id: string }) => {
      const { data, error } = await supabase
        .from('workouts')
        .update({
          title: values.title,
          workout_date: values.workout_date,
          duration_minutes: values.duration_minutes,
          notes: values.notes || null,
        })
        .eq('id', id)
        .eq('user_id', session.user.id)
        .select('id, user_id, display_name, workout_date, title, notes, duration_minutes, created_at')
        .single()

      if (error) {
        throw error
      }

      return data as Workout
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workouts'] })
      void queryClient.invalidateQueries({ queryKey: ['earliest-workout-date'] })
    },
  })

  const deleteWorkout = useMutation({
    mutationFn: async (workoutId: string) => {
      const { data, error } = await supabase
        .from('workouts')
        .delete()
        .eq('id', workoutId)
        .eq('user_id', session.user.id)
        .select('id')
        .single()

      if (error) {
        throw error
      }

      return data.id
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workouts'] })
      void queryClient.invalidateQueries({ queryKey: ['earliest-workout-date'] })
    },
  })

  const updateDisplayName = useMutation({
    mutationFn: async (displayName: string) => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', session.user.id)
        .select('id, display_name')
        .single()

      if (error) {
        throw error
      }

      return data as Profile
    },
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData<Profile>(['profile', session.user.id], updatedProfile)
      queryClient.setQueryData<Profile[]>(['crew-profiles'], (profiles) =>
        profiles?.map((profile) => profile.id === updatedProfile.id ? updatedProfile : profile),
      )
    },
  })

  if (profileQuery.isLoading) {
    return <StatusScreen title="Loading" message="Checking your access..." />
  }

  if (profileQuery.error) {
    return (
      <StatusScreen
        title="Access check failed"
        message={profileQuery.error.message}
      />
    )
  }

  if (!profileQuery.data) {
    return (
      <StatusScreen
        title="Not approved yet"
        message={`You are signed in as ${session.user.email ?? 'an unknown email'}, but that email is not approved yet.`}
      />
    )
  }

  if (crewProfilesQuery.error || earliestWorkoutQuery.error || workoutsQuery.error) {
    return (
      <StatusScreen
        title="Could not load the workout feed"
        message={(crewProfilesQuery.error ?? earliestWorkoutQuery.error ?? workoutsQuery.error)?.message ?? 'Try refreshing the page.'}
      />
    )
  }

  const currentProfile = profileQuery.data

  const submitWorkout = (values: WorkoutFormValues) => createWorkout.mutateAsync({
    ...values,
    displayName: currentProfile.display_name,
  })

  const submitMobileWorkout = async (values: WorkoutFormValues) => {
    await submitWorkout(values)
    onCloseWorkoutForm()
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-4">
        <div className="rounded border border-stone-200 bg-white p-5">
          <p className="text-sm text-stone-500">Signed in as {profileQuery.data.display_name}</p>
          <h2 className="mt-1 text-3xl font-semibold">Team workout feed</h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Metric label="Workouts" value={workoutsQuery.data?.length ?? 0} />
            <Metric label="Minutes" value={totalMinutes} />
          </div>
        </div>

        {workoutsQuery.isLoading || crewProfilesQuery.isLoading || earliestWorkoutQuery.isLoading ? (
          <StatusScreen title="Loading" message="Pulling recent workouts..." />
        ) : (
          <WorkoutFeed
            columns={crewColumns}
            currentUserId={profileQuery.data.id}
            earliestWorkoutDate={earliestWorkoutQuery.data}
            isDeletingWorkout={deleteWorkout.isPending}
            isUpdatingDisplayName={updateDisplayName.isPending}
            isUpdatingWorkout={updateWorkout.isPending}
            onDeleteWorkout={(workoutId) => deleteWorkout.mutateAsync(workoutId).then(() => undefined)}
            onSelectWeek={setSelectedWeekStart}
            onUpdateDisplayName={(displayName) => updateDisplayName.mutateAsync(displayName).then(() => undefined)}
            onUpdateWorkout={(workout, values) => updateWorkout.mutateAsync({ id: workout.id, ...values }).then(() => undefined)}
            selectedWeekStart={selectedWeekStart}
          />
        )}
      </section>

      <aside className="hidden md:block">
        <WorkoutForm
          isSaving={createWorkout.isPending}
          key={workoutFormVersion}
          onSubmit={submitWorkout}
        />
        {createWorkout.error ? (
          <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {createWorkout.error.message}
          </p>
        ) : null}
      </aside>
      </div>
      <WorkoutFormModal
        errorMessage={createWorkout.error?.message}
        isOpen={isWorkoutFormOpen}
        isSaving={createWorkout.isPending}
        onClose={onCloseWorkoutForm}
        onSubmit={submitMobileWorkout}
      />
    </>
  )
}

function useProfile(userId: string) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      const { data: ensuredProfile, error: ensureError } = await supabase.rpc('ensure_profile')

      if (ensureError) {
        throw ensureError
      }

      if (ensuredProfile?.[0]) {
        return {
          id: ensuredProfile[0].profile_id,
          display_name: ensuredProfile[0].display_name,
        } satisfies Profile
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name')
        .eq('id', userId)
        .maybeSingle()

      if (error) {
        throw error
      }

      return data as Profile | null
    },
  })
}

function useEarliestWorkoutDate(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['earliest-workout-date'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workouts')
        .select('workout_date')
        .order('workout_date', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (error) {
        throw error
      }

      return data?.workout_date
    },
  })
}

function useWorkouts(enabled: boolean, weekStart: string) {
  const weekEnd = addDays(weekStart, 7)

  return useQuery({
    enabled,
    queryKey: ['workouts', weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workouts')
        .select('id, user_id, display_name, workout_date, title, notes, duration_minutes, created_at')
        .gte('workout_date', weekStart)
        .lt('workout_date', weekEnd)
        .order('workout_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) {
        throw error
      }

      return (data ?? []) as Workout[]
    },
  })
}

function useCrewProfiles(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['crew-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name')
        .order('display_name', { ascending: true })

      if (error) {
        throw error
      }

      return (data ?? []) as Profile[]
    },
  })
}

function WorkoutForm({
  embedded = false,
  isSaving,
  onSubmit,
}: {
  embedded?: boolean
  isSaving: boolean
  onSubmit: (values: WorkoutFormValues) => Promise<void>
}) {
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
  } = useForm<WorkoutFormInput, unknown, WorkoutFormValues>({
    defaultValues: {
      duration_minutes: 45,
      notes: '',
      title: '',
      workout_date: today,
    },
    resolver: zodResolver(workoutSchema),
  })

  const submit = async (values: WorkoutFormValues) => {
    await onSubmit(values)
    reset({
      duration_minutes: 45,
      notes: '',
      title: '',
      workout_date: today,
    })
  }

  return (
    <form className={embedded ? '' : 'rounded border border-stone-200 bg-white p-5 shadow-sm'} onSubmit={handleSubmit(submit)}>
      {embedded ? null : <h2 className="text-xl font-semibold">Log workout</h2>}
      <div className={embedded ? 'space-y-4' : 'mt-5 space-y-4'}>
        <label className="form-field">
          <span>Title</span>
          <input placeholder="Push day, 5k run, legs..." {...register('title')} />
          {errors.title ? <small>{errors.title.message}</small> : null}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="form-field">
            <span>Date</span>
            <input type="date" {...register('workout_date')} />
            {errors.workout_date ? <small>{errors.workout_date.message}</small> : null}
          </label>
          <label className="form-field">
            <span>Minutes</span>
            <input type="number" min="1" max="600" {...register('duration_minutes')} />
            {errors.duration_minutes ? <small>{errors.duration_minutes.message}</small> : null}
          </label>
        </div>
        <label className="form-field">
          <span>Notes</span>
          <textarea placeholder="Exercises, sets, weights, how it felt..." rows={6} {...register('notes')} />
          {errors.notes ? <small>{errors.notes.message}</small> : null}
        </label>
        <button className="button-primary w-full" disabled={isSaving} type="submit">
          {isSaving ? 'Saving...' : 'Save workout'}
        </button>
      </div>
    </form>
  )
}

function WorkoutFormModal({
  errorMessage,
  isOpen,
  isSaving,
  onClose,
  onSubmit,
}: {
  errorMessage?: string
  isOpen: boolean
  isSaving: boolean
  onClose: () => void
  onSubmit: (values: WorkoutFormValues) => Promise<void>
}) {
  useEffect(() => {
    if (!isOpen) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        onClose()
      }
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [isOpen, isSaving, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-stone-950/40 p-4 md:hidden"
      onMouseDown={(event) => {
        if (!isSaving && event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div aria-labelledby="mobile-workout-form-title" aria-modal="true" className="max-h-full w-full max-w-md overflow-y-auto rounded border border-stone-200 bg-white p-5 shadow-xl" role="dialog">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold" id="mobile-workout-form-title">Log workout</h2>
          <button aria-label="Close workout form" className="button-secondary" disabled={isSaving} type="button" onClick={onClose}>Close</button>
        </div>
        <WorkoutForm
          embedded
          isSaving={isSaving}
          onSubmit={onSubmit}
        />
        {errorMessage ? (
          <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
        ) : null}
      </div>
    </div>
  )
}

type CrewColumn = {
  profile: Profile
  workouts: Workout[]
  totalMinutes: number
}

function createCrewColumns(profiles: Profile[], workouts: Workout[]): CrewColumn[] {
  const columnsByUserId = new Map<string, CrewColumn>(
    profiles.map((profile): [string, CrewColumn] => [
      profile.id,
      { profile, totalMinutes: 0, workouts: [] },
    ]),
  )

  for (const workout of workouts) {
    const column = columnsByUserId.get(workout.user_id)

    if (column) {
      column.workouts.push(workout)
      column.totalMinutes += workout.duration_minutes
    }
  }

  return Array.from(columnsByUserId.values())
}

function WorkoutFeed({
  columns,
  currentUserId,
  earliestWorkoutDate,
  isDeletingWorkout,
  isUpdatingDisplayName,
  isUpdatingWorkout,
  onDeleteWorkout,
  onSelectWeek,
  onUpdateDisplayName,
  onUpdateWorkout,
  selectedWeekStart,
}: {
  columns: CrewColumn[]
  currentUserId: string
  earliestWorkoutDate?: string
  isDeletingWorkout: boolean
  isUpdatingDisplayName: boolean
  isUpdatingWorkout: boolean
  onDeleteWorkout: (workoutId: string) => Promise<void>
  onSelectWeek: (weekStart: string) => void
  onUpdateDisplayName: (displayName: string) => Promise<void>
  onUpdateWorkout: (workout: Workout, values: WorkoutFormValues) => Promise<void>
  selectedWeekStart: string
}) {
  if (columns.length === 0) {
    return (
      <div className="rounded border border-dashed border-stone-300 bg-white p-8 text-center">
        <h2 className="text-xl font-semibold">No crew members yet</h2>
        <p className="mt-2 text-stone-600">Add approved members and their profiles will appear here.</p>
      </div>
    )
  }

  return (
    <>
      <WeekSelector
        earliestWorkoutDate={earliestWorkoutDate}
        onSelectWeek={onSelectWeek}
        selectedWeekStart={selectedWeekStart}
      />
      <MobileWorkoutFeed
        columns={columns}
        currentUserId={currentUserId}
        isDeletingWorkout={isDeletingWorkout}
        isUpdatingDisplayName={isUpdatingDisplayName}
        isUpdatingWorkout={isUpdatingWorkout}
        onDeleteWorkout={onDeleteWorkout}
        onUpdateDisplayName={onUpdateDisplayName}
        onUpdateWorkout={onUpdateWorkout}
      />
      <div className="hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-3">
        {columns.map((column) => (
          <WorkoutColumnCard
            column={column}
            isCurrentUser={column.profile.id === currentUserId}
            isDeletingWorkout={isDeletingWorkout}
            isUpdatingDisplayName={isUpdatingDisplayName}
            isUpdatingWorkout={isUpdatingWorkout}
            key={column.profile.id}
            onDeleteWorkout={onDeleteWorkout}
            onUpdateDisplayName={onUpdateDisplayName}
            onUpdateWorkout={onUpdateWorkout}
          />
        ))}
      </div>
    </>
  )
}

function WeekSelector({
  earliestWorkoutDate,
  onSelectWeek,
  selectedWeekStart,
}: {
  earliestWorkoutDate?: string
  onSelectWeek: (weekStart: string) => void
  selectedWeekStart: string
}) {
  const earliestWeekStart = earliestWorkoutDate ? weekStartForDate(dateFromInput(earliestWorkoutDate)) : currentWeekStart
  const availableWeekCount = Math.max(0, weeksBetween(earliestWeekStart, currentWeekStart))
  const selectedWeekIndex = Math.min(
    availableWeekCount,
    Math.max(0, weeksBetween(earliestWeekStart, selectedWeekStart)),
  )
  const weekEnd = addDays(selectedWeekStart, 6)
  const weekLabel = `${dateFromInput(selectedWeekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${dateFromInput(weekEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <section aria-label="Workout week" className="rounded border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-stone-500">Showing week</p>
          <h2 className="text-lg font-semibold">{weekLabel}</h2>
        </div>
        <button
          className="button-secondary"
          disabled={selectedWeekStart === currentWeekStart}
          type="button"
          onClick={() => onSelectWeek(currentWeekStart)}
        >
          This week
        </button>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          aria-label="Show previous week"
          className="button-secondary"
          disabled={selectedWeekIndex === 0}
          type="button"
          onClick={() => onSelectWeek(addDays(selectedWeekStart, -7))}
        >
          ←
        </button>
        <input
          aria-label="Select workout week"
          className="min-w-0 flex-1 accent-emerald-600"
          disabled={availableWeekCount === 0}
          max={availableWeekCount}
          min="0"
          step="1"
          type="range"
          value={selectedWeekIndex}
          onChange={(event) => onSelectWeek(addDays(earliestWeekStart, Number(event.target.value) * 7))}
        />
        <button
          aria-label="Show next week"
          className="button-secondary"
          disabled={selectedWeekStart === currentWeekStart}
          type="button"
          onClick={() => onSelectWeek(addDays(selectedWeekStart, 7))}
        >
          →
        </button>
      </div>
    </section>
  )
}

function MobileWorkoutFeed({
  columns,
  currentUserId,
  isDeletingWorkout,
  isUpdatingDisplayName,
  isUpdatingWorkout,
  onDeleteWorkout,
  onUpdateDisplayName,
  onUpdateWorkout,
}: {
  columns: CrewColumn[]
  currentUserId: string
  isDeletingWorkout: boolean
  isUpdatingDisplayName: boolean
  isUpdatingWorkout: boolean
  onDeleteWorkout: (workoutId: string) => Promise<void>
  onUpdateDisplayName: (displayName: string) => Promise<void>
  onUpdateWorkout: (workout: Workout, values: WorkoutFormValues) => Promise<void>
}) {
  const [selectedUserId, setSelectedUserId] = useState(currentUserId)
  const selectedColumn = columns.find((column) => column.profile.id === selectedUserId) ?? columns[0]

  return (
    <div className="md:hidden">
      <div aria-label="Crew members" className="-mx-3 overflow-x-auto px-3 pb-3" role="tablist">
        <div className="flex w-max min-w-full gap-2">
          {columns.map((column) => {
            const isSelected = column.profile.id === selectedColumn.profile.id

            return (
              <button
                aria-controls={`member-workouts-${column.profile.id}`}
                aria-selected={isSelected}
                className={isSelected ? 'button-primary whitespace-nowrap' : 'button-secondary whitespace-nowrap'}
                id={`member-tab-${column.profile.id}`}
                key={column.profile.id}
                onClick={() => setSelectedUserId(column.profile.id)}
                role="tab"
                type="button"
              >
                {column.profile.display_name}
              </button>
            )
          })}
        </div>
      </div>
      <div
        aria-labelledby={`member-tab-${selectedColumn.profile.id}`}
        id={`member-workouts-${selectedColumn.profile.id}`}
        role="tabpanel"
      >
        <WorkoutColumnCard
          column={selectedColumn}
          isCurrentUser={selectedColumn.profile.id === currentUserId}
          isDeletingWorkout={isDeletingWorkout}
          isUpdatingDisplayName={isUpdatingDisplayName}
          isUpdatingWorkout={isUpdatingWorkout}
          onDeleteWorkout={onDeleteWorkout}
          onUpdateDisplayName={onUpdateDisplayName}
          onUpdateWorkout={onUpdateWorkout}
        />
      </div>
    </div>
  )
}

function WorkoutColumnCard({
  column,
  isCurrentUser,
  isDeletingWorkout,
  isUpdatingDisplayName,
  isUpdatingWorkout,
  onDeleteWorkout,
  onUpdateDisplayName,
  onUpdateWorkout,
}: {
  column: CrewColumn
  isCurrentUser: boolean
  isDeletingWorkout: boolean
  isUpdatingDisplayName: boolean
  isUpdatingWorkout: boolean
  onDeleteWorkout: (workoutId: string) => Promise<void>
  onUpdateDisplayName: (displayName: string) => Promise<void>
  onUpdateWorkout: (workout: Workout, values: WorkoutFormValues) => Promise<void>
}) {
  return (
    <section className="overflow-hidden rounded border border-stone-200 bg-white shadow-sm">
      <header className="border-b border-stone-200 bg-stone-50 p-4">
        {isCurrentUser ? (
          <EditableDisplayName
            displayName={column.profile.display_name}
            isSaving={isUpdatingDisplayName}
            onSave={onUpdateDisplayName}
          />
        ) : (
          <h3 className="break-words text-xl font-semibold">{column.profile.display_name}</h3>
        )}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-stone-600">
          <span><strong className="font-semibold text-stone-950">{column.workouts.length}</strong> workouts</span>
          <span><strong className="font-semibold text-stone-950">{column.totalMinutes}</strong> min</span>
        </div>
      </header>
      {column.workouts.length === 0 ? (
        <p className="p-4 text-sm text-stone-600">No workouts logged yet.</p>
      ) : (
        <div className="divide-y divide-stone-200">
          {column.workouts.map((workout) => (
            <EditableWorkout
              canManage={isCurrentUser}
              isDeleting={isDeletingWorkout}
              isSaving={isUpdatingWorkout}
              key={workout.id}
              onDelete={onDeleteWorkout}
              onSave={onUpdateWorkout}
              workout={workout}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function EditableWorkout({
  canManage,
  isDeleting,
  isSaving,
  onDelete,
  onSave,
  workout,
}: {
  canManage: boolean
  isDeleting: boolean
  isSaving: boolean
  onDelete: (workoutId: string) => Promise<void>
  onSave: (workout: Workout, values: WorkoutFormValues) => Promise<void>
  workout: Workout
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
  } = useForm<WorkoutFormInput, unknown, WorkoutFormValues>({
    defaultValues: workoutToFormValues(workout),
    resolver: zodResolver(workoutSchema),
  })

  const cancel = () => {
    reset(workoutToFormValues(workout))
    setError(null)
    setIsEditing(false)
  }

  const save = async (values: WorkoutFormValues) => {
    setError(null)

    try {
      await onSave(workout, values)
      setIsEditing(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update this workout.')
    }
  }

  const remove = async () => {
    if (!window.confirm(`Delete “${workout.title}”? This cannot be undone.`)) {
      return
    }

    setError(null)

    try {
      await onDelete(workout.id)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this workout.')
    }
  }

  if (isEditing) {
    return (
      <form className="space-y-4 p-4" onSubmit={handleSubmit(save)}>
        <label className="form-field">
          <span>Title</span>
          <input {...register('title')} />
          {errors.title ? <small>{errors.title.message}</small> : null}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="form-field">
            <span>Date</span>
            <input type="date" {...register('workout_date')} />
            {errors.workout_date ? <small>{errors.workout_date.message}</small> : null}
          </label>
          <label className="form-field">
            <span>Minutes</span>
            <input type="number" min="1" max="600" {...register('duration_minutes')} />
            {errors.duration_minutes ? <small>{errors.duration_minutes.message}</small> : null}
          </label>
        </div>
        <label className="form-field">
          <span>Notes</span>
          <textarea rows={5} {...register('notes')} />
          {errors.notes ? <small>{errors.notes.message}</small> : null}
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="button-primary" disabled={isSaving} type="submit">
            {isSaving ? 'Saving...' : 'Save changes'}
          </button>
          <button className="button-secondary" disabled={isSaving} type="button" onClick={cancel}>Cancel</button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </form>
    )
  }

  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-stone-500">
            {new Date(`${workout.workout_date}T00:00:00`).toLocaleDateString()}
          </p>
          <h4 className="mt-1 break-words font-semibold">{workout.title}</h4>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-sm font-medium text-amber-800">{workout.duration_minutes} min</span>
          {canManage ? (
            <>
              <button
                aria-label={`Edit ${workout.title}`}
                className="rounded p-1 text-stone-500 hover:bg-stone-200 hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                disabled={isDeleting || isSaving}
                type="button"
                onClick={() => setIsEditing(true)}
              >
                <span aria-hidden="true">✎</span>
              </button>
              <button
                aria-label={`Delete ${workout.title}`}
                className="rounded p-1 text-stone-500 hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-600"
                disabled={isDeleting || isSaving}
                type="button"
                onClick={remove}
              >
                <span aria-hidden="true">🗑</span>
              </button>
            </>
          ) : null}
        </div>
      </div>
      {workout.notes ? <p className="mt-3 break-words whitespace-pre-line text-sm text-stone-700">{workout.notes}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </article>
  )
}

function workoutToFormValues(workout: Workout): WorkoutFormValues {
  return {
    duration_minutes: workout.duration_minutes,
    notes: workout.notes ?? '',
    title: workout.title,
    workout_date: workout.workout_date,
  }
}

function EditableDisplayName({
  displayName,
  isSaving,
  onSave,
}: {
  displayName: string
  isSaving: boolean
  onSave: (displayName: string) => Promise<void>
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(displayName)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isEditing) {
      setValue(displayName)
    }
  }, [displayName, isEditing])

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedDisplayName = displayNameSchema.safeParse(value)

    if (!parsedDisplayName.success) {
      setError(parsedDisplayName.error.issues[0]?.message ?? 'Enter a valid display name.')
      return
    }

    setError(null)

    try {
      await onSave(parsedDisplayName.data)
      setIsEditing(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update your display name.')
    }
  }

  if (isEditing) {
    return (
      <form className="flex flex-wrap items-start gap-2" onSubmit={save}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Display name</span>
          <input aria-invalid={Boolean(error)} className="w-full" value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <button className="button-primary" disabled={isSaving} type="submit">{isSaving ? 'Saving...' : 'Save'}</button>
        <button
          className="button-secondary"
          disabled={isSaving}
          type="button"
          onClick={() => {
            setValue(displayName)
            setError(null)
            setIsEditing(false)
          }}
        >
          Cancel
        </button>
        {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
      </form>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <h3 className="break-words text-xl font-semibold">{displayName}</h3>
      <button
        aria-label="Edit display name"
        className="rounded p-1 text-stone-500 hover:bg-stone-200 hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        type="button"
        onClick={() => setIsEditing(true)}
      >
        <span aria-hidden="true">✎</span>
      </button>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-stone-200 bg-stone-50 p-4">
      <p className="text-sm text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function StatusScreen({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-5 text-center shadow-sm sm:p-8">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-stone-600">{message}</p>
    </div>
  )
}

export default App
