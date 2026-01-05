import { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { COLORS } from '@/lib/constants'
import { InventoryRequest, InventoryItem, Location, UserProfile } from '@/types/database.types'

interface RequestWithDetails extends InventoryRequest {
  item: InventoryItem
  location: Location
  requester: UserProfile
}

type RequestStatus = 'pending' | 'approved' | 'denied'

export default function AdminRequestsScreen() {
  const { profile } = useAuth()
  const [requests, setRequests] = useState<RequestWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<RequestStatus | 'all'>('pending')

  // Response modal
  const [responseModalVisible, setResponseModalVisible] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<RequestWithDetails | null>(null)
  const [responseNotes, setResponseNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchRequests = useCallback(async () => {
    if (!profile?.organization_id) return

    try {
      let query = supabase
        .from('inventory_requests')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('requested_at', { ascending: false })

      if (filter !== 'all') {
        query = query.eq('status', filter)
      }

      const { data: requestsData, error } = await query

      if (error) throw error

      // Fetch related data for each request
      const requestsWithDetails: RequestWithDetails[] = await Promise.all(
        (requestsData || []).map(async (request) => {
          const [itemResult, locationResult, requesterResult] = await Promise.all([
            supabase.from('inventory_items').select('*').eq('id', request.item_id).single(),
            supabase.from('locations').select('*').eq('id', request.location_id).single(),
            supabase.from('user_profiles').select('*').eq('id', request.requested_by).single(),
          ])

          return {
            ...request,
            item: itemResult.data!,
            location: locationResult.data!,
            requester: requesterResult.data!,
          }
        })
      )

      setRequests(requestsWithDetails.filter(r => r.item && r.location && r.requester))
    } catch (error) {
      console.error('Error fetching requests:', error)
    } finally {
      setLoading(false)
    }
  }, [profile?.organization_id, filter])

  useFocusEffect(
    useCallback(() => {
      fetchRequests()
    }, [fetchRequests])
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchRequests()
    setRefreshing(false)
  }

  const openResponseModal = (request: RequestWithDetails) => {
    setSelectedRequest(request)
    setResponseNotes('')
    setResponseModalVisible(true)
  }

  const handleRespond = async (approved: boolean) => {
    if (!selectedRequest || !profile?.id) return

    setSubmitting(true)
    try {
      const { error: updateError } = await supabase
        .from('inventory_requests')
        .update({
          status: approved ? 'approved' : 'denied',
          responded_by: profile.id,
          responded_at: new Date().toISOString(),
          response_notes: responseNotes || null,
        })
        .eq('id', selectedRequest.id)

      if (updateError) throw updateError

      // If approved, update the item assignment quantity
      if (approved) {
        // Check if assignment exists
        const { data: existingAssignment } = await supabase
          .from('item_assignments')
          .select('*')
          .eq('item_id', selectedRequest.item_id)
          .eq('location_id', selectedRequest.location_id)
          .is('revoked_at', null)
          .single()

        if (existingAssignment) {
          // Update existing assignment
          const newQuantity = (existingAssignment.quantity_assigned || 0) + selectedRequest.quantity_requested
          await supabase
            .from('item_assignments')
            .update({ quantity_assigned: newQuantity })
            .eq('id', existingAssignment.id)
        } else {
          // Create new assignment
          await supabase.from('item_assignments').insert({
            item_id: selectedRequest.item_id,
            location_id: selectedRequest.location_id,
            assigned_by: profile.id,
            quantity_assigned: selectedRequest.quantity_requested,
            notes: `Fulfilled from request #${selectedRequest.id.slice(0, 8)}`,
          })
        }

        // Record in location history
        const currentQuantity = existingAssignment?.quantity_assigned || 0
        await supabase.from('location_history').insert({
          item_id: selectedRequest.item_id,
          user_id: profile.id,
          action: 'restock',
          quantity_change: selectedRequest.quantity_requested,
          quantity_after: currentQuantity + selectedRequest.quantity_requested,
          location_name: selectedRequest.location.name,
          notes: `Request approved: ${selectedRequest.quantity_requested} units`,
        })
      }

      alert(`Request ${approved ? 'approved' : 'denied'} successfully!`)
      setResponseModalVisible(false)
      await fetchRequests()
    } catch (error) {
      console.error('Error responding to request:', error)
      alert('Failed to respond to request: ' + (error as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusColor = (status: RequestStatus) => {
    switch (status) {
      case 'pending':
        return COLORS.warning
      case 'approved':
        return COLORS.success
      case 'denied':
        return COLORS.error
    }
  }

  const getStatusLabel = (status: RequestStatus) => {
    switch (status) {
      case 'pending':
        return 'Pending'
      case 'approved':
        return 'Approved'
      case 'denied':
        return 'Denied'
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Inventory Requests</Text>
          <Text style={styles.subtitle}>Review and respond to item requests</Text>
        </View>

        {/* Filter tabs */}
        <View style={styles.filterTabs}>
          {(['pending', 'approved', 'denied', 'all'] as const).map((status) => (
            <TouchableOpacity
              key={status}
              style={[styles.filterTab, filter === status && styles.filterTabActive]}
              onPress={() => setFilter(status)}
            >
              <Text
                style={[styles.filterTabText, filter === status && styles.filterTabTextActive]}
              >
                {status === 'all' ? 'All' : getStatusLabel(status)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {requests.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No Requests</Text>
            <Text style={styles.emptyText}>
              {filter === 'pending'
                ? 'No pending requests to review.'
                : `No ${filter === 'all' ? '' : filter} requests found.`}
            </Text>
          </View>
        ) : (
          <View style={styles.requestsList}>
            {requests.map((request) => (
              <TouchableOpacity
                key={request.id}
                style={styles.requestCard}
                onPress={() => request.status === 'pending' && openResponseModal(request)}
                disabled={request.status !== 'pending'}
              >
                <View style={styles.requestHeader}>
                  <View style={styles.requestInfo}>
                    <Text style={styles.itemName}>{request.item.name}</Text>
                    <Text style={styles.locationName}>{request.location.name}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(request.status) + '20' }]}>
                    <Text style={[styles.statusText, { color: getStatusColor(request.status) }]}>
                      {getStatusLabel(request.status)}
                    </Text>
                  </View>
                </View>

                <View style={styles.requestDetails}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Quantity:</Text>
                    <Text style={styles.detailValue}>{request.quantity_requested}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Requested by:</Text>
                    <Text style={styles.detailValue}>
                      {request.requester.display_name || request.requester.email}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Date:</Text>
                    <Text style={styles.detailValue}>{formatDate(request.requested_at)}</Text>
                  </View>
                  {request.notes && (
                    <View style={styles.notesRow}>
                      <Text style={styles.detailLabel}>Notes:</Text>
                      <Text style={styles.notesText}>{request.notes}</Text>
                    </View>
                  )}
                  {request.response_notes && (
                    <View style={styles.notesRow}>
                      <Text style={styles.detailLabel}>Response:</Text>
                      <Text style={styles.notesText}>{request.response_notes}</Text>
                    </View>
                  )}
                </View>

                {request.status === 'pending' && (
                  <View style={styles.actionHint}>
                    <Text style={styles.actionHintText}>Tap to review</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Response Modal */}
      <Modal
        visible={responseModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setResponseModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Review Request</Text>

            {selectedRequest && (
              <>
                <View style={styles.modalSection}>
                  <Text style={styles.modalLabel}>Item</Text>
                  <Text style={styles.modalValue}>{selectedRequest.item.name}</Text>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalLabel}>Location</Text>
                  <Text style={styles.modalValue}>{selectedRequest.location.name}</Text>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalLabel}>Quantity Requested</Text>
                  <Text style={styles.modalValue}>{selectedRequest.quantity_requested}</Text>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalLabel}>Requested By</Text>
                  <Text style={styles.modalValue}>
                    {selectedRequest.requester.display_name || selectedRequest.requester.email}
                  </Text>
                </View>

                {selectedRequest.notes && (
                  <View style={styles.modalSection}>
                    <Text style={styles.modalLabel}>Request Notes</Text>
                    <Text style={styles.modalValue}>{selectedRequest.notes}</Text>
                  </View>
                )}

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Response Notes (optional)</Text>
                  <TextInput
                    style={[styles.input, styles.inputMultiline]}
                    value={responseNotes}
                    onChangeText={setResponseNotes}
                    placeholder="Add a note about your decision..."
                    placeholderTextColor={COLORS.textSecondary}
                    multiline
                    numberOfLines={3}
                  />
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setResponseModalVisible(false)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.denyButton, submitting && styles.buttonDisabled]}
                    onPress={() => handleRespond(false)}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.denyButtonText}>Deny</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.approveButton, submitting && styles.buttonDisabled]}
                    onPress={() => handleRespond(true)}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.approveButtonText}>Approve</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  filterTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterTabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  filterTabTextActive: {
    color: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  requestsList: {
    gap: 12,
  },
  requestCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  requestInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  locationName: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  requestDetails: {
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  detailValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  notesRow: {
    marginTop: 4,
  },
  notesText: {
    fontSize: 14,
    color: COLORS.text,
    marginTop: 2,
    fontStyle: 'italic',
  },
  actionHint: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    alignItems: 'center',
  },
  actionHintText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 20,
  },
  modalSection: {
    marginBottom: 12,
  },
  modalLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  modalValue: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  inputGroup: {
    marginTop: 8,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inputMultiline: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelButtonText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  denyButton: {
    flex: 1,
    backgroundColor: COLORS.error,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  denyButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  approveButton: {
    flex: 1,
    backgroundColor: COLORS.success,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  approveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
})
