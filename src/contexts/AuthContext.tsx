import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { Session, User, AuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { UserProfile, Organization } from '@/types/database.types'

interface AuthState {
  session: Session | null
  user: User | null
  profile: UserProfile | null
  organization: Organization | null
  loading: boolean
  initialized: boolean
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signUp: (email: string, password: string, organizationName: string, displayName?: string) => Promise<{ error: AuthError | null }>
  signUpWithInvite: (email: string, password: string, organizationId: string, displayName?: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>
  refreshProfile: () => Promise<void>
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    organization: null,
    loading: true,
    initialized: false,
  })

  // Fetch user profile and organization with timeout
  const fetchUserData = useCallback(async (userId: string) => {
    console.log('Fetching user data for:', userId)
    try {
      // Fetch profile with timeout
      const profilePromise = supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Profile fetch timeout')), 8000)
      )

      const { data: profile, error: profileError } = await Promise.race([
        profilePromise,
        timeoutPromise
      ]) as any

      if (profileError) {
        console.error('Error fetching profile:', profileError)
        return { profile: null, organization: null }
      }

      console.log('Profile loaded:', profile?.email)

      // Fetch organization
      const { data: organization, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', profile.organization_id)
        .single()

      if (orgError) {
        console.error('Error fetching organization:', orgError)
        return { profile, organization: null }
      }

      console.log('Organization loaded:', organization?.name)
      return { profile, organization }
    } catch (error) {
      console.error('Error in fetchUserData:', error)
      return { profile: null, organization: null }
    }
  }, [])

  // Initialize auth state
  useEffect(() => {
    let mounted = true

    async function initializeAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!mounted) return

        if (session?.user) {
          const { profile, organization } = await fetchUserData(session.user.id)
          setState({
            session,
            user: session.user,
            profile,
            organization,
            loading: false,
            initialized: true,
          })
        } else {
          setState({
            session: null,
            user: null,
            profile: null,
            organization: null,
            loading: false,
            initialized: true,
          })
        }
      } catch (error) {
        console.error('Error initializing auth:', error)
        if (mounted) {
          setState(prev => ({ ...prev, loading: false, initialized: true }))
        }
      }
    }

    // Safety timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      console.warn('Auth initialization timed out - forcing initialized state')
      setState({
        session: null,
        user: null,
        profile: null,
        organization: null,
        loading: false,
        initialized: true,
      })
    }, 5000)

    initializeAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return

        if (event === 'SIGNED_IN' && session?.user) {
          const { profile, organization } = await fetchUserData(session.user.id)
          setState({
            session,
            user: session.user,
            profile,
            organization,
            loading: false,
            initialized: true,
          })
        } else if (event === 'SIGNED_OUT') {
          setState({
            session: null,
            user: null,
            profile: null,
            organization: null,
            loading: false,
            initialized: true,
          })
        } else if (event === 'TOKEN_REFRESHED' && session) {
          setState(prev => ({ ...prev, session }))
        }
      }
    )

    return () => {
      mounted = false
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [fetchUserData])

  // Sign in with email and password
  const signIn = async (email: string, password: string) => {
    setState(prev => ({ ...prev, loading: true }))

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setState(prev => ({ ...prev, loading: false }))
    }

    return { error }
  }

  // Sign up and create organization (first user becomes admin)
  const signUp = async (
    email: string,
    password: string,
    organizationName: string,
    displayName?: string
  ) => {
    setState(prev => ({ ...prev, loading: true }))

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          organization_name: organizationName,
          display_name: displayName,
        },
      },
    })

    if (error) {
      setState(prev => ({ ...prev, loading: false }))
    }

    return { error }
  }

  // Sign up with invite (join existing organization)
  const signUpWithInvite = async (
    email: string,
    password: string,
    organizationId: string,
    displayName?: string
  ) => {
    setState(prev => ({ ...prev, loading: true }))

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          organization_id: organizationId,
          display_name: displayName,
        },
      },
    })

    if (error) {
      setState(prev => ({ ...prev, loading: false }))
    }

    return { error }
  }

  // Sign out
  const signOut = async () => {
    setState(prev => ({ ...prev, loading: true }))
    await supabase.auth.signOut()
  }

  // Reset password
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://outstocked.vercel.app',
    })

    return { error }
  }

  // Refresh profile data
  const refreshProfile = async () => {
    if (!state.user) return

    const { profile, organization } = await fetchUserData(state.user.id)
    setState(prev => ({ ...prev, profile, organization }))
  }

  const value: AuthContextType = {
    ...state,
    signIn,
    signUp,
    signUpWithInvite,
    signOut,
    resetPassword,
    refreshProfile,
    isAdmin: state.profile?.role === 'admin',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
