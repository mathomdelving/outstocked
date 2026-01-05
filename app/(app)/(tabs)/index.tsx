import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native'
import { useState, useCallback } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { COLORS, LOCATION_ACTION_LABELS } from '@/lib/constants'
import {
  Location,
  InventoryItem,
  LocationHistory,
  InventoryRequest,
  UserProfile,
  LocationAction,
} from '@/types/database.types'

interface DashboardStats {
  totalItems: number
  totalQuantity: number
  lowStockCount: number
  pendingRequests: number
}

interface LocationWithAssignments extends Location {
  totalAssigned: number
  itemCount: number
  pendingRequests: number
}

interface ActivityWithDetails extends LocationHistory {
  item?: InventoryItem
  recorded_by?: UserProfile
}

interface RequestWithDetails extends InventoryRequest {
  location?: Location
  item?: InventoryItem
  requester?: UserProfile
}

export default function DashboardScreen() {
  const { profile, organization, isAdmin } = useAuth()
  const [stats, setStats] = useState<DashboardStats>({
    totalItems: 0,
    totalQuantity: 0,
    lowStockCount: 0,
    pendingRequests: 0,
  })
  const [locations, setLocations] = useState<LocationWithAssignments[]>([])
  const [recentActivity, setRecentActivity] = useState<ActivityWithDetails[]>([])
  const [pendingRequests, setPendingRequests] = useState<RequestWithDetails[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [processingRequest, setProcessingRequest] = useState<string | null>(null)

  const fetchDashboardData = useCallback(async () => {
    if (!profile?.organization_id) return

    try {
      // Fetch inventory items for stats
      const { data: items } = await supabase
        .from('inventory_items')
        .select('id, quantity')
        .eq('organization_id', profile.organization_id)
        .is('deleted_at', null)

      const totalItems = items?.length || 0
      const totalQuantity = items?.reduce((sum, item) => sum + item.quantity, 0) || 0
      const lowStockCount = items?.filter(item => item.quantity <= 10).length || 0

      // Fetch pending requests count
      const { count: pendingCount } = await supabase
        .from('inventory_requests')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id)
        .eq('status', 'pending')

      setStats({
        totalItems,
        totalQuantity,
        lowStockCount,
        pendingRequests: pendingCount || 0,
      })

      // Fetch locations with assignment totals
      const { data: locationsData } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('name')

      // Get assignment totals and pending requests for each location
      const locationsWithAssignments: LocationWithAssignments[] = await Promise.all(
        (locationsData || []).map(async (location) => {
          const [assignmentsResult, requestsResult] = await Promise.all([
            supabase
              .from('item_assignments')
              .select('quantity_assigned')
              .eq('location_id', location.id)
              .is('revoked_at', null),
            supabase
              .from('inventory_requests')
              .select('*', { count: 'exact', head: true })
              .eq('location_id', location.id)
              .eq('status', 'pending'),
          ])

          const assignments = assignmentsResult.data || []
          const totalAssigned = assignments.reduce(
            (sum, a) => sum + (a.quantity_assigned || 0),
            0
          )
          const itemCount = assignments.length
          const pendingRequests = requestsResult.count || 0

          return { ...location, totalAssigned, itemCount, pendingRequests }
        })
      )
      setLocations(locationsWithAssignments)

      // Fetch recent activity (last 10 entries)
      const { data: activityData } = await supabase
        .from('location_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)

      // Fetch details for each activity
      const activityWithDetails: ActivityWithDetails[] = await Promise.all(
        (activityData || []).map(async (entry) => {
          let item: InventoryItem | undefined
          let recorded_by: UserProfile | undefined

          try {
            const { data: itemData } = await supabase
              .from('inventory_items')
              .select('*')
              .eq('id', entry.item_id)
              .single()
            item = itemData || undefined
          } catch {}

          if (entry.user_id) {
            try {
              const { data: userData } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('id', entry.user_id)
                .single()
              recorded_by = userData || undefined
            } catch {}
          }

          return { ...entry, item, recorded_by }
        })
      )
      setRecentActivity(activityWithDetails)

      // Fetch pending requests (admin only)
      if (isAdmin) {
        const { data: requestsData } = await supabase
          .from('inventory_requests')
          .select('*')
          .eq('organization_id', profile.organization_id)
          .eq('status', 'pending')
          .order('requested_at', { ascending: false })
          .limit(5)

        // Fetch details for each request
        const requestsWithDetails: RequestWithDetails[] = await Promise.all(
          (requestsData || []).map(async (req) => {
            let location: Location | undefined
            let item: InventoryItem | undefined
            let requester: UserProfile | undefined

            try {
              const { data: locData } = await supabase
                .from('locations')
                .select('*')
                .eq('id', req.location_id)
                .single()
              location = locData || undefined
            } catch {}

            try {
              const { data: itemData } = await supabase
                .from('inventory_items')
                .select('*')
                .eq('id', req.item_id)
                .single()
              item = itemData || undefined
            } catch {}

            try {
              const { data: userData } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('id', req.requested_by)
                .single()
              requester = userData || undefined
            } catch {}

            return { ...req, location, item, requester }
          })
        )
        setPendingRequests(requestsWithDetails)
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }, [profile?.organization_id, isAdmin])

  useFocusEffect(
    useCallback(() => {
      fetchDashboardData()
    }, [fetchDashboardData])
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchDashboardData()
    setRefreshing(false)
  }

  const getTimeAgo = (dateString: string) => {
    const now = new Date()
    const date = new Date(dateString)
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  const handleApproveRequest = async (request: RequestWithDetails) => {
    if (!profile?.id) return

    setProcessingRequest(request.id)
    try {
      // Create an assignment for this location
      const { error: assignmentError } = await supabase
        .from('item_assignments')
        .insert({
          item_id: request.item_id,
          location_id: request.location_id,
          assigned_by: profile.id,
          quantity_assigned: request.quantity_requested,
          notes: `Approved request: ${request.notes || 'No notes'}`,
        })

      if (assignmentError) throw assignmentError

      // Update the request status
      const { error: updateError } = await supabase
        .from('inventory_requests')
        .update({
          status: 'approved',
          responded_by: profile.id,
          responded_at: new Date().toISOString(),
          response_notes: 'Approved',
        })
        .eq('id', request.id)

      if (updateError) throw updateError

      alert(`Approved ${request.quantity_requested} ${request.item?.name || 'items'} for ${request.location?.name}`)
      await fetchDashboardData()
    } catch (error) {
      console.error('Error approving request:', error)
      alert('Failed to approve request: ' + (error as Error).message)
    } finally {
      setProcessingRequest(null)
    }
  }

  const handleDenyRequest = async (request: RequestWithDetails) => {
    if (!profile?.id) return

    setProcessingRequest(request.id)
    try {
      const { error } = await supabase
        .from('inventory_requests')
        .update({
          status: 'denied',
          responded_by: profile.id,
          responded_at: new Date().toISOString(),
          response_notes: 'Denied',
        })
        .eq('id', request.id)

      if (error) throw error

      alert(`Request from ${request.location?.name} has been denied`)
      await fetchDashboardData()
    } catch (error) {
      console.error('Error denying request:', error)
      alert('Failed to deny request: ' + (error as Error).message)
    } finally {
      setProcessingRequest(null)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>
            Welcome back, {profile?.display_name || 'there'}!
          </Text>
          <Text style={styles.orgName}>{organization?.name}</Text>
          {isAdmin && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Admin</Text>
            </View>
          )}
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalItems}</Text>
            <Text style={styles.statLabel}>Total Items</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalQuantity.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Total Quantity</Text>
          </View>

          <TouchableOpacity
            style={[styles.statCard, stats.lowStockCount > 0 && styles.statCardWarning]}
            onPress={() => router.push('/(app)/(tabs)/inventory')}
          >
            <Text style={[styles.statValue, stats.lowStockCount > 0 && styles.statValueWarning]}>
              {stats.lowStockCount}
            </Text>
            <Text style={styles.statLabel}>Low Stock</Text>
          </TouchableOpacity>

          {isAdmin && (
            <View style={[styles.statCard, stats.pendingRequests > 0 && styles.statCardPrimary]}>
              <Text style={[styles.statValue, stats.pendingRequests > 0 && styles.statValuePrimary]}>
                {stats.pendingRequests}
              </Text>
              <Text style={styles.statLabel}>Pending Requests</Text>
            </View>
          )}
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/(app)/(tabs)/inventory')}
            >
              <Text style={styles.actionIcon}>📦</Text>
              <Text style={styles.actionLabel}>View Inventory</Text>
            </TouchableOpacity>

            {isAdmin && (
              <>
                <TouchableOpacity
                  style={styles.actionCard}
                  onPress={() => router.push('/(app)/(admin)/items/create')}
                >
                  <Text style={styles.actionIcon}>➕</Text>
                  <Text style={styles.actionLabel}>Add Item</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionCard}
                  onPress={() => router.push('/(app)/(admin)/locations')}
                >
                  <Text style={styles.actionIcon}>📍</Text>
                  <Text style={styles.actionLabel}>Locations</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionCard}
                  onPress={() => router.push('/(app)/(admin)/users')}
                >
                  <Text style={styles.actionIcon}>👥</Text>
                  <Text style={styles.actionLabel}>Users</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Location Overview */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Location Overview</Text>
            {isAdmin && (
              <TouchableOpacity onPress={() => router.push('/(app)/(admin)/locations')}>
                <Text style={styles.seeAllText}>See All</Text>
              </TouchableOpacity>
            )}
          </View>

          {locations.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No locations set up yet</Text>
              {isAdmin && (
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => router.push('/(app)/(admin)/locations')}
                >
                  <Text style={styles.emptyButtonText}>Create Location</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            locations.slice(0, 5).map((location) => (
              <TouchableOpacity
                key={location.id}
                style={styles.locationCard}
                onPress={() => router.push(`/(app)/(admin)/locations/${location.id}`)}
              >
                <View style={styles.locationInfo}>
                  <Text style={styles.locationName}>{location.name}</Text>
                  <Text style={styles.locationMeta}>
                    {location.itemCount} item{location.itemCount !== 1 ? 's' : ''} assigned
                  </Text>
                </View>
                <View style={styles.locationStatsRow}>
                  {location.pendingRequests > 0 && (
                    <View style={styles.locationRequestsBox}>
                      <Text style={styles.locationRequestsCount}>{location.pendingRequests}</Text>
                      <Text style={styles.locationRequestsLabel}>requests</Text>
                    </View>
                  )}
                  <View style={styles.locationStats}>
                    <Text style={styles.locationQuantity}>{location.totalAssigned.toLocaleString()}</Text>
                    <Text style={styles.locationQuantityLabel}>units</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Pending Requests (Admin Only) */}
        {isAdmin && pendingRequests.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Pending Requests</Text>
              <View style={styles.requestBadge}>
                <Text style={styles.requestBadgeText}>{stats.pendingRequests}</Text>
              </View>
            </View>

            {pendingRequests.map((req) => (
              <View key={req.id} style={styles.requestCard}>
                <View style={styles.requestInfo}>
                  <Text style={styles.requestTitle}>
                    {req.location?.name || 'Unknown'} requests {req.quantity_requested}x {req.item?.name || 'item'}
                  </Text>
                  <Text style={styles.requestMeta}>
                    by {req.requester?.display_name || req.requester?.email || 'Unknown'} • {getTimeAgo(req.requested_at)}
                  </Text>
                  {req.notes && <Text style={styles.requestNotes}>{req.notes}</Text>}
                </View>
                <View style={styles.requestActions}>
                  <TouchableOpacity
                    style={[styles.approveButton, processingRequest === req.id && styles.buttonDisabled]}
                    onPress={() => handleApproveRequest(req)}
                    disabled={processingRequest === req.id}
                  >
                    <Text style={styles.approveButtonText}>✓</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.denyButton, processingRequest === req.id && styles.buttonDisabled]}
                    onPress={() => handleDenyRequest(req)}
                    disabled={processingRequest === req.id}
                  >
                    <Text style={styles.denyButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Recent Activity */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>

          {recentActivity.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No activity recorded yet</Text>
            </View>
          ) : (
            recentActivity.slice(0, 5).map((entry) => (
              <View key={entry.id} style={styles.activityCard}>
                <View style={styles.activityIcon}>
                  <Text style={styles.activityIconText}>
                    {entry.action === 'sale'
                      ? '💰'
                      : entry.action === 'giveaway'
                      ? '🎁'
                      : entry.action === 'restock'
                      ? '📦'
                      : '📝'}
                  </Text>
                </View>
                <View style={styles.activityContent}>
                  <Text style={styles.activityText}>
                    <Text style={styles.activityAction}>
                      {LOCATION_ACTION_LABELS[entry.action as LocationAction]}
                    </Text>
                    {' '}
                    {Math.abs(entry.quantity_change)} {entry.item?.name || 'item'}
                    {entry.location_name && ` at ${entry.location_name}`}
                  </Text>
                  <Text style={styles.activityMeta}>
                    {entry.recorded_by?.display_name || entry.recorded_by?.email || 'Unknown'} • {getTimeAgo(entry.created_at)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  orgName: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  badge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    width: '48%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statCardWarning: {
    borderColor: COLORS.warning,
    backgroundColor: COLORS.warning + '10',
  },
  statCardPrimary: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  statValueWarning: {
    color: COLORS.warning,
  },
  statValuePrimary: {
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    minWidth: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  // Location cards
  locationCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  locationInfo: {
    flex: 1,
  },
  locationName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  locationMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  locationStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationStats: {
    alignItems: 'center',
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  locationQuantity: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  locationQuantityLabel: {
    fontSize: 11,
    color: COLORS.primary,
  },
  locationRequestsBox: {
    alignItems: 'center',
    backgroundColor: COLORS.warning + '15',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  locationRequestsCount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.warning,
  },
  locationRequestsLabel: {
    fontSize: 11,
    color: COLORS.warning,
  },
  // Request cards
  requestCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  requestInfo: {
    flex: 1,
  },
  requestTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  requestMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  requestNotes: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  approveButton: {
    backgroundColor: COLORS.success + '20',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  approveButtonText: {
    fontSize: 16,
    color: COLORS.success,
    fontWeight: 'bold',
  },
  denyButton: {
    backgroundColor: COLORS.error + '20',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  denyButtonText: {
    fontSize: 16,
    color: COLORS.error,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  requestBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
  },
  requestBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  // Activity cards
  activityCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityIconText: {
    fontSize: 16,
  },
  activityContent: {
    flex: 1,
  },
  activityText: {
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 2,
  },
  activityAction: {
    fontWeight: '600',
  },
  activityMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  // Empty states
  emptyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  emptyButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})
