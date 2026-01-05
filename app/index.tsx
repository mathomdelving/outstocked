import { Redirect } from 'expo-router'
import { useAuth } from '@/contexts/AuthContext'

export default function Index() {
  const { user, initialized, needsPasswordSetup } = useAuth()

  if (!initialized) {
    return null
  }

  // Redirect based on auth state
  if (user) {
    // Invited users need to set their password first
    if (needsPasswordSetup) {
      return <Redirect href="/(auth)/set-password" />
    }
    return <Redirect href="/(app)/(tabs)" />
  }

  return <Redirect href="/(auth)/login" />
}
