import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { supabase } from './lib/supabase'

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
})

const magicLinkSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
})

type LoginFormValues = z.infer<typeof loginSchema>
type MagicLinkFormValues = z.infer<typeof magicLinkSchema>

export function Login() {
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
