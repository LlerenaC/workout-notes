import { zodResolver } from '@hookform/resolvers/zod'
import type { Session } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { z } from 'zod'
import { supabase } from './lib/supabase'
import type { Profile, Workout } from './types'

const workoutSchema = z.object({
  display_name: z.string().trim().min(2, 'Enter the name to show on this workout.').max(80),
  title: z.string().min(2, 'Give the workout a short title.'),
  workout_date: z.string().min(1, 'Pick a date.'),
  duration_minutes: z.coerce.number().int().min(1).max(600),
  notes: z.string().max(2000).optional(),
})

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
})

const magicLinkSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
})

type WorkoutFormInput = z.input<typeof workoutSchema>
type WorkoutFormValues = z.output<typeof workoutSchema>
type LoginFormValues = z.infer<typeof loginSchema>
type MagicLinkFormValues = z.infer<typeof magicLinkSchema>

const today = new Date().toISOString().slice(0, 10)

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)

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
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <BrowserRouter>
      <Shell session={session}>
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
              element={session ? <Dashboard session={session} /> : <Navigate to="/login" replace />}
            />
          </Routes>
        )}
      </Shell>
    </BrowserRouter>
  )
}

function Shell({ children, session }: { children: React.ReactNode; session?: Session | null }) {
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
            <button className="button-secondary shrink-0" type="button" onClick={signOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-6">{children}</main>
    </div>
  )
}

function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [authError, setAuthError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const signInForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  })
  const magicLinkForm = useForm<MagicLinkFormValues>({
    resolver: zodResolver(magicLinkSchema),
  })

  const signIn = async ({ email, password }: LoginFormValues) => {
    setAuthError(null)
    setSentTo(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setAuthError(error.message)
    }
  }

  const sendMagicLink = async ({ email }: MagicLinkFormValues) => {
    setAuthError(null)
    setSentTo(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true,
      },
    })

    if (error) {
      setAuthError(error.message)
      return
    }

    setSentTo(email)
  }

  return (
    <section className="grid min-h-[calc(100vh-140px)] place-items-center">
      <div className="w-full max-w-md rounded border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-2xl font-semibold">
          {mode === 'signin' ? 'Sign in' : 'Create access'}
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          {mode === 'signin'
            ? 'Use your email and password once your account is set up.'
            : 'Use one of the three approved emails and Supabase will send a magic link.'}
        </p>

        <div className="mt-5 grid grid-cols-2 rounded border border-stone-200 bg-stone-100 p-1">
          <button
            className={mode === 'signin' ? 'auth-tab-active' : 'auth-tab'}
            type="button"
            onClick={() => {
              setMode('signin')
              setAuthError(null)
              setSentTo(null)
            }}
          >
            Sign in
          </button>
          <button
            className={mode === 'signup' ? 'auth-tab-active' : 'auth-tab'}
            type="button"
            onClick={() => {
              setMode('signup')
              setAuthError(null)
              setSentTo(null)
            }}
          >
            Sign up
          </button>
        </div>

        {mode === 'signin' ? (
          <form className="mt-6 space-y-4" onSubmit={signInForm.handleSubmit(signIn)}>
            <label className="form-field">
              <span>Email</span>
              <input type="email" placeholder="you@example.com" {...signInForm.register('email')} />
              {signInForm.formState.errors.email ? (
                <small>{signInForm.formState.errors.email.message}</small>
              ) : null}
            </label>
            <label className="form-field">
              <span>Password</span>
              <input type="password" placeholder="Your password" {...signInForm.register('password')} />
              {signInForm.formState.errors.password ? (
                <small>{signInForm.formState.errors.password.message}</small>
              ) : null}
            </label>
            <button className="button-primary w-full" disabled={signInForm.formState.isSubmitting} type="submit">
              {signInForm.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={magicLinkForm.handleSubmit(sendMagicLink)}>
            <label className="form-field">
              <span>Email</span>
              <input type="email" placeholder="you@example.com" {...magicLinkForm.register('email')} />
              {magicLinkForm.formState.errors.email ? (
                <small>{magicLinkForm.formState.errors.email.message}</small>
              ) : null}
            </label>
            <button className="button-primary w-full" disabled={magicLinkForm.formState.isSubmitting} type="submit">
              {magicLinkForm.formState.isSubmitting ? 'Sending...' : 'Send signup link'}
            </button>
          </form>
        )}

        {authError ? (
          <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {authError}
          </p>
        ) : null}
        {sentTo ? (
          <p className="mt-4 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Check {sentTo} for your signup link.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function Dashboard({ session }: { session: Session }) {
  const queryClient = useQueryClient()
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
    mutationFn: async (values: WorkoutFormValues) => {
      const { error } = await supabase.from('workouts').insert({
        display_name: values.display_name,
        title: values.title,
        workout_date: values.workout_date,
        duration_minutes: values.duration_minutes,
        notes: values.notes || null,
      })

      if (error) {
        throw error
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workouts'] }),
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

  return (
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
          <WorkoutFeed columns={crewColumns} />
        )}
      </section>

      <aside>
        <WorkoutForm
          defaultDisplayName={profileQuery.data.display_name}
          isSaving={createWorkout.isPending}
          onSubmit={(values) => createWorkout.mutateAsync(values)}
        />
        {createWorkout.error ? (
          <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {createWorkout.error.message}
          </p>
        ) : null}
      </aside>
    </div>
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
  defaultDisplayName,
  isSaving,
  onSubmit,
}: {
  defaultDisplayName: string
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
      display_name: defaultDisplayName,
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
      display_name: defaultDisplayName,
      duration_minutes: 45,
      notes: '',
      title: '',
      workout_date: today,
    })
  }

  return (
    <form className="rounded border border-stone-200 bg-white p-5 shadow-sm" onSubmit={handleSubmit(submit)}>
      <h2 className="text-xl font-semibold">Log workout</h2>
      <div className="mt-5 space-y-4">
        <label className="form-field">
          <span>Display name</span>
          <input placeholder="Your name" {...register('display_name')} />
          {errors.display_name ? <small>{errors.display_name.message}</small> : null}
        </label>
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

function WorkoutFeed({ columns }: { columns: CrewColumn[] }) {
  if (columns.length === 0) {
    return (
      <div className="rounded border border-dashed border-stone-300 bg-white p-8 text-center">
        <h2 className="text-xl font-semibold">No crew members yet</h2>
        <p className="mt-2 text-stone-600">Add approved members and their profiles will appear here.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {columns.map((column) => (
        <section key={column.profile.id} className="overflow-hidden rounded border border-stone-200 bg-white shadow-sm">
          <header className="border-b border-stone-200 bg-stone-50 p-4">
            <h3 className="break-words text-xl font-semibold">{column.profile.display_name}</h3>
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
      ))}
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
