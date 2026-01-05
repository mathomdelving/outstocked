import React, { createContext, useContext, useEffect, useState } from 'react'
import { Session, User, AuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { UserProfile, Organization } from '@/types/database.types'

interface AuthState {
  session: Session | null
  user: User | null
  profile: UserProfile | null
  organization: Organization | null
  initialized: boolean
  needsPasswordSetup: boolean
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signUp: (email: string, password: string, organizationName: string, displayName?: string) => Promise<{ error: AuthError | null }>
  signUpWithInvite: (email: string, password: string, organizationId: string, displayName?: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>
  refreshProfile: () => Promise<void>
  completePasswordSetup: (password: string, displayName?: string) => Promise<{ error: Error | null }>
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    organization: null,
    initialized: false,
    needsPasswordSetup: false,
  })

  // Fetch user profile and organization (non-blocking helper)
  const loadProfileData = async (userId: string) => {
    try {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      // If no profile exists, check if this is an invited user
      if (profileError || !profile) {
        console.log('No profile found, checking if invited user...')
        const { data: { user } } = await supabase.auth.getUser()

        // If user was invited (has invited_by in metadata), they need to complete setup
        if (user?.user_metadata?.invited_by) {
          console.log('Invited user needs to complete password setup')
          setState(prev => ({
            ...prev,
            needsPasswordSetup: true,
          }))
          return
        }

        // For non-invited users with org metadata, auto-create profile
        if (user?.user_metadata?.organization_id) {
          const { data: newProfile, error: createError } = await supabase
            .from('user_profiles')
            .insert({
              id: userId,
              organization_id: user.user_metadata.organization_id,
              email: user.email,
              display_name: user.user_metadata.display_name || user.email?.split('@')[0],
              role: user.user_metadata.invited_role || 'user',
            })
            .select()
            .single()

          if (createError) {
            console.error('Error creating profile:', createError)
            return
          }

          const { data: organization } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', newProfile.organization_id)
            .single()

          setState(prev => ({
            ...prev,
            profile: newProfile,
            organization: organization || null,
            needsPasswordSetup: false,
          }))
          return
        }

        console.log('No organization_id in user metadata')
        return
      }

      // Profile exists - load organization
      const { data: organization } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', profile.organization_id)
        .single()

      setState(prev => ({
        ...prev,
        profile,
        organization: organization || null,
        needsPasswordSetup: false,
      }))
    } catch (error) {
      console.error('Error loading profile:', error)
    }
  }

  // Initialize auth on mount
  useEffect(() => {
    let isMounted = true

    const initialize = async () => {
      try {
        // Get the current session
        const { data: { session }, error } = await supabase.auth.getSession()

        if (error) {
          console.error('Error getting session:', error)
        }

        if (!isMounted) return

        if (session?.user) {
          setState({
            session,
            user: session.user,
            profile: null,
            organization: null,
            initialized: true,
          })
          // Load profile data in background
          loadProfileData(session.user.id)
        } else {
          setState({
            session: null,
            user: null,
            profile: null,
            organization: null,
            initialized: true,
          })
        }
      } catch (error) {
        console.error('Auth initialization error:', error)
        if (isMounted) {
          setState(prev => ({ ...prev, initialized: true }))
        }
      }
    }

    initialize()

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth event:', event)

        if (!isMounted) return

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            setState(prev => ({
              ...prev,
              session,
              user: session.user,
              initialized: true,
            }))
            loadProfileData(session.user.id)
          }
        } else if (event === 'SIGNED_OUT') {
          setState({
            session: null,
            user: null,
            profile: null,
            organization: null,
            initialized: true,
          })
        }
      }
    )

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  // Sign in
  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  // Sign up with new organization
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

  // Sign up with invite
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

  // Refresh profile
  const refreshProfile = async () => {
    if (state.user) {
      await loadProfileData(state.user.id)
    }
  }

  // Complete password setup for invited users
  const completePasswordSetup = async (password: string, displayName?: string) => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        return { error: new Error('Not authenticated') }
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: {
          display_name: displayName || user.user_metadata?.display_name || user.email?.split('@')[0],
        },
      })

      if (updateError) {
        return { error: new Error(updateError.message) }
      }

      // Create profile
      const orgId = user.user_metadata?.organization_id
      if (!orgId) {
        return { error: new Error('No organization found') }
      }

      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert({
          id: user.id,
          organization_id: orgId,
          email: user.email,
          display_name: displayName || user.user_metadata?.display_name || user.email?.split('@')[0],
          role: user.user_metadata?.invited_role || 'user',
        })

      if (profileError) {
        return { error: new Error(profileError.message) }
      }

      // Clear needsPasswordSetup and load profile
      setState(prev => ({ ...prev, needsPasswordSetup: false }))
      await loadProfileData(user.id)

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  }

  const value: AuthContextType = {
    ...state,
    signIn,
    signUp,
    signUpWithInvite,
    signOut,
    resetPassword,
    refreshProfile,
    completePasswordSetup,
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
