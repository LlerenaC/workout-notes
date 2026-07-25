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

const today = new Date().toISOString().slice(0, 10)

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
  const profileQuery = useProfile(session.user.id)
  const crewProfilesQuery = useCrewProfiles(Boolean(profileQuery.data))
  const workoutsQuery = useWorkouts(Boolean(profileQuery.data))

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
    },
  })

  const updateDisplayName = useMutation({
    mutationFn: async (displayName: string) => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', session.user.id)
        .select('id')

      if (error) {
        throw error
      }

      if (data.length === 0) {
        throw new Error('Your display name could not be updated. Confirm the profile update policy has been applied in Supabase.')
      }
    },
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile', session.user.id] }),
      queryClient.invalidateQueries({ queryKey: ['crew-profiles'] }),
    ]),
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

  if (crewProfilesQuery.error || workoutsQuery.error) {
    return (
      <StatusScreen
        title="Could not load the workout feed"
        message={(crewProfilesQuery.error ?? workoutsQuery.error)?.message ?? 'Try refreshing the page.'}
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

        {workoutsQuery.isLoading || crewProfilesQuery.isLoading ? (
          <StatusScreen title="Loading" message="Pulling recent workouts..." />
        ) : (
          <WorkoutFeed
            columns={crewColumns}
            currentUserId={profileQuery.data.id}
            isUpdatingDisplayName={updateDisplayName.isPending}
            onUpdateDisplayName={(displayName) => updateDisplayName.mutateAsync(displayName)}
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

function useWorkouts(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['workouts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workouts')
        .select('id, user_id, display_name, workout_date, title, notes, duration_minutes, created_at')
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
  isUpdatingDisplayName,
  onUpdateDisplayName,
}: {
  columns: CrewColumn[]
  currentUserId: string
  isUpdatingDisplayName: boolean
  onUpdateDisplayName: (displayName: string) => Promise<void>
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
      <MobileWorkoutFeed
        columns={columns}
        currentUserId={currentUserId}
        isUpdatingDisplayName={isUpdatingDisplayName}
        onUpdateDisplayName={onUpdateDisplayName}
      />
      <div className="hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-3">
        {columns.map((column) => (
          <WorkoutColumnCard
            column={column}
            isCurrentUser={column.profile.id === currentUserId}
            isUpdatingDisplayName={isUpdatingDisplayName}
            key={column.profile.id}
            onUpdateDisplayName={onUpdateDisplayName}
          />
        ))}
      </div>
    </>
  )
}

function MobileWorkoutFeed({
  columns,
  currentUserId,
  isUpdatingDisplayName,
  onUpdateDisplayName,
}: {
  columns: CrewColumn[]
  currentUserId: string
  isUpdatingDisplayName: boolean
  onUpdateDisplayName: (displayName: string) => Promise<void>
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
          isUpdatingDisplayName={isUpdatingDisplayName}
          onUpdateDisplayName={onUpdateDisplayName}
        />
      </div>
    </div>
  )
}

function WorkoutColumnCard({
  column,
  isCurrentUser,
  isUpdatingDisplayName,
  onUpdateDisplayName,
}: {
  column: CrewColumn
  isCurrentUser: boolean
  isUpdatingDisplayName: boolean
  onUpdateDisplayName: (displayName: string) => Promise<void>
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
            <article key={workout.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-stone-500">
                    {new Date(`${workout.workout_date}T00:00:00`).toLocaleDateString()}
                  </p>
                  <h4 className="mt-1 break-words font-semibold">{workout.title}</h4>
                </div>
                <span className="shrink-0 text-sm font-medium text-amber-800">{workout.duration_minutes} min</span>
              </div>
              {workout.notes ? <p className="mt-3 break-words whitespace-pre-line text-sm text-stone-700">{workout.notes}</p> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
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
