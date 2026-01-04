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

  // Fetch user profile and organization
  const fetchUserData = useCallback(async (userId: string) => {
    try {
      // Fetch profile
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (profileError) {
        console.error('Error fetching profile:', profileError)
        return { profile: null, organization: null }
      }

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
        console.log('Initializing auth...')
        const { data: { session } } = await supabase.auth.getSession()
        console.log('Got session:', session?.user?.email || 'no user')

        if (!mounted) return

        if (session?.user) {
          // Set user state immediately
          setState(prev => ({
            ...prev,
            session,
            user: session.user,
            loading: false,
            initialized: true,
          }))

          // Fetch profile data in background (non-blocking)
          fetchUserData(session.user.id).then(({ profile, organization }) => {
            if (mounted) {
              console.log('Profile loaded:', profile?.display_name)
              setState(prev => ({ ...prev, profile, organization }))
            }
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

    // Safety timeout to prevent infinite loading (keeps session intact)
    const timeout = setTimeout(() => {
      console.warn('Auth initialization timed out - forcing initialized state')
      setState(prev => ({ ...prev, loading: false, initialized: true }))
    }, 8000)

    initializeAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session?.user?.email)
        if (!mounted) return

        if (event === 'SIGNED_IN' && session?.user) {
          // Update user state IMMEDIATELY so redirects can happen
          setState(prev => ({
            ...prev,
            session,
            user: session.user,
            loading: false,
            initialized: true,
          }))

          // Then fetch profile data in background (non-blocking)
          fetchUserData(session.user.id).then(({ profile, organization }) => {
            if (mounted) {
              setState(prev => ({ ...prev, profile, organization }))
            }
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
  // Note: We don't set global loading state here - individual pages manage their own loading
  // The onAuthStateChange listener will handle updating user/session state
  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    return { error }
  }

  // Sign up and create organization (first user becomes admin)
  const signUp = async (
    email: string,
    password: string,
    organizationName: string,
    displayName?: string
  ) => {
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

    return { error }
  }

  // Sign up with invite (join existing organization)
  const signUpWithInvite = async (
    email: string,
    password: string,
    organizationId: string,
    displayName?: string
  ) => {
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

    return { error }
  }

  // Sign out
  const signOut = async () => {
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
