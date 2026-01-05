import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' })
    }

    const token = authHeader.replace('Bearer ', '')

    // Clients
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Verify user
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check admin status
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can invite users' })
    }

    // Parse emails
    const { emails } = req.body
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one email' })
    }

    if (emails.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 invites at a time' })
    }

    // Send invites
    const results = []
    for (const email of emails) {
      const trimmedEmail = email.trim().toLowerCase()

      if (!trimmedEmail || !trimmedEmail.includes('@')) {
        results.push({ email: trimmedEmail || email, success: false, error: 'Invalid email' })
        continue
      }

      try {
        const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          trimmedEmail,
          {
            data: {
              organization_id: profile.organization_id,
              invited_by: user.id,
              invited_role: 'user',
            },
            redirectTo: 'https://outstocked.vercel.app/set-password',
          }
        )

        if (inviteError) {
          results.push({ email: trimmedEmail, success: false, error: inviteError.message })
        } else {
          results.push({ email: trimmedEmail, success: true })
        }
      } catch (e) {
        results.push({ email: trimmedEmail, success: false, error: 'Failed to send' })
      }
    }

    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    return res.status(200).json({
      message: `Sent ${successful} invite(s)${failed > 0 ? `, ${failed} failed` : ''}`,
      results,
    })
  } catch (error) {
    console.error('Invite error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
