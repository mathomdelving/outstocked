import { Stack } from 'expo-router'
import { Redirect } from 'expo-router'
import { useAuth } from '@/contexts/AuthContext'
import { COLORS } from '@/lib/constants'

export default function AuthLayout() {
  const { user, initialized, needsPasswordSetup } = useAuth()

  // If user is logged in AND doesn't need password setup, redirect to app
  // Allow users who need password setup to stay in auth flow
  if (initialized && user && !needsPasswordSetup) {
    return <Redirect href="/(app)/(tabs)" />
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="invite" />
      <Stack.Screen name="set-password" />
    </Stack>
  )
}
