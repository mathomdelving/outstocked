import { Stack } from 'expo-router'
import { Redirect } from 'expo-router'
import { useAuth } from '@/contexts/AuthContext'
import { COLORS } from '@/lib/constants'

export default function AuthLayout() {
  const { user, initialized } = useAuth()

  // If user is logged in, redirect to app
  if (initialized && user) {
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
    </Stack>
  )
}
