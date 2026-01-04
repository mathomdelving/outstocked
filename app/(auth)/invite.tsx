import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { COLORS } from '@/lib/constants'

export default function InviteScreen() {
  const params = useLocalSearchParams<{ org: string }>()

  const [org, setOrg] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [loadingOrg, setLoadingOrg] = useState(true)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [linkExpired, setLinkExpired] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(true)

  // Get org ID from URL params and check for Supabase errors in hash
  useEffect(() => {
    let orgId = params.org

    if (typeof window !== 'undefined') {
      // Parse org from URL search params as fallback
      if (!orgId) {
        const urlParams = new URLSearchParams(window.location.search)
        orgId = urlParams.get('org') || undefined
      }

      // Check for Supabase error in hash fragment (e.g., expired link)
      const hash = window.location.hash
      if (hash.includes('error=') || hash.includes('error_code=')) {
        console.log('Supabase error in URL:', hash)
        if (hash.includes('otp_expired') || hash.includes('access_denied')) {
          setLinkExpired(true)
        }
      }
    }

    console.log('Org ID found:', orgId)
    if (orgId) {
      setOrg(orgId)
    } else {
      setLoadingOrg(false)
    }
  }, [params.org])

  // Check if user is already authenticated (from magic link)
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession()

      if (session?.user) {
        console.log('User already authenticated')
      }

      setCheckingAuth(false)
    }

    checkAuth()
  }, [])

  // Fetch organization name when we have org ID
  useEffect(() => {
    if (!org) return

    async function fetchOrg() {
      console.log('Fetching organization:', org)
      const { data, error } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', org)
        .single()

      if (error) {
        console.error('Error fetching org:', error)
      }

      if (data) {
        console.log('Found organization:', data.name)
        setOrgName(data.name)
      }
      setLoadingOrg(false)
    }

    fetchOrg()
  }, [org])

  const handleSignUp = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in email and password')
      return
    }

    if (!org) {
      Alert.alert('Error', 'Invalid invite link')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          organization_id: org,
          display_name: displayName || email.split('@')[0],
        },
      },
    })

    if (error) {
      setLoading(false)
      Alert.alert('Error', error.message)
    }
    // On success, the onAuthStateChange listener will update state
    // and the layout redirects will handle navigation automatically
  }

  const handleSignIn = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in email and password')
      return
    }

    setLoading(true)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setLoading(false)
      Alert.alert('Error', error.message)
      return
    }

    // If user signed in successfully but isn't in this org, we need to add them
    // Check if they have a profile for this org
    if (data.user && org) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', data.user.id)
        .single()

      if (profile && profile.organization_id !== org) {
        // User belongs to a different org - can't join multiple orgs in current design
        setLoading(false)
        Alert.alert(
          'Already in Organization',
          'Your account is already associated with another organization. Please use a different email to join this organization.'
        )
        await supabase.auth.signOut()
        return
      }
    }

    // On success, the onAuthStateChange listener will update state
    // and the layout redirects will handle navigation automatically
  }

  if (loadingOrg || checkingAuth) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={{ color: COLORS.textSecondary, marginTop: 16 }}>
            {checkingAuth ? 'Checking your account...' : 'Loading organization...'}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!org) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Invalid Invite</Text>
          <Text style={styles.subtitle}>
            This invite link is missing the organization information.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/(auth)/login')}
          >
            <Text style={styles.buttonText}>Go to Login</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (!orgName) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Organization Not Found</Text>
          <Text style={styles.subtitle}>
            We couldn't find this organization. The invite may be outdated.
          </Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            Org ID: {org}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/(auth)/login')}
          >
            <Text style={styles.buttonText}>Go to Login</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Join {orgName}</Text>
            <Text style={styles.subtitle}>
              You've been invited to join {orgName} on Outstocked
            </Text>
            {linkExpired && (
              <View style={{ backgroundColor: '#FEF3C7', padding: 12, borderRadius: 8, marginTop: 16 }}>
                <Text style={{ color: '#92400E', fontSize: 14, textAlign: 'center' }}>
                  The email link has expired. Please create an account or sign in below.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, isSignUp && styles.tabActive]}
              onPress={() => setIsSignUp(true)}
            >
              <Text style={[styles.tabText, isSignUp && styles.tabTextActive]}>
                Create Account
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, !isSignUp && styles.tabActive]}
              onPress={() => setIsSignUp(false)}
            >
              <Text style={[styles.tabText, !isSignUp && styles.tabTextActive]}>
                Sign In
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            {isSignUp && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Your Name</Text>
                <TextInput
                  style={styles.input}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Enter your name"
                  placeholderTextColor={COLORS.textSecondary}
                  autoCapitalize="words"
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={COLORS.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={isSignUp ? 'Create a password' : 'Enter your password'}
                placeholderTextColor={COLORS.textSecondary}
                secureTextEntry
                autoComplete="password"
              />
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={isSignUp ? handleSignUp : handleSignIn}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading
                  ? 'Please wait...'
                  : isSignUp
                  ? `Join ${orgName}`
                  : 'Sign In & Join'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    marginBottom: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: 24,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: '#fff',
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
