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
import { COLORS, LOCATION_ACTION_LABELS } from '@/lib/constants'
import {
  Location,
  InventoryItem,
  ItemAssignment,
  LocationAction,
} from '@/types/database.types'
import { Picker } from '@react-native-picker/picker'

interface LocationWithItems extends Location {
  assignments: (ItemAssignment & { item: InventoryItem })[]
}

interface RequestForm {
  locationId: string
  itemId: string
  quantity: number
  notes: string
}

export default function MyLocationsScreen() {
  const { profile } = useAuth()
  const [locations, setLocations] = useState<LocationWithItems[]>([])
  const [allItems, setAllItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Request modal
  const [requestModalVisible, setRequestModalVisible] = useState(false)
  const [requestForm, setRequestForm] = useState<RequestForm>({
    locationId: '',
    itemId: '',
    quantity: 1,
    notes: '',
  })
  const [submittingRequest, setSubmittingRequest] = useState(false)

  // Action modal (for recording sales, giveaways, etc.)
  const [actionModalVisible, setActionModalVisible] = useState(false)
  const [selectedAssignment, setSelectedAssignment] = useState<(ItemAssignment & { item: InventoryItem }) | null>(null)
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null)
  const [actionType, setActionType] = useState<LocationAction>('sale')
  const [actionQuantity, setActionQuantity] = useState('1')
  const [actionNotes, setActionNotes] = useState('')
  const [submittingAction, setSubmittingAction] = useState(false)

  const fetchData = useCallback(async () => {
    if (!profile?.id || !profile?.organization_id) return

    try {
      // Get locations this user manages
      const { data: managedLocations } = await supabase
        .from('location_managers')
        .select('location_id')
        .eq('user_id', profile.id)
        .is('revoked_at', null)

      const locationIds = managedLocations?.map(m => m.location_id) || []

      if (locationIds.length === 0) {
        setLocations([])
        setLoading(false)
        return
      }

      // Get location details
      const { data: locationsData } = await supabase
        .from('locations')
        .select('*')
        .in('id', locationIds)
        .order('name')

      // Get assignments for each location with item details
      const locationsWithItems: LocationWithItems[] = await Promise.all(
        (locationsData || []).map(async (location) => {
          const { data: assignments } = await supabase
            .from('item_assignments')
            .select('*')
            .eq('location_id', location.id)
            .is('revoked_at', null)

          // Get item details for each assignment
          const assignmentsWithItems = await Promise.all(
            (assignments || []).map(async (assignment) => {
              const { data: item } = await supabase
                .from('inventory_items')
                .select('*')
                .eq('id', assignment.item_id)
                .single()
              return { ...assignment, item: item! }
            })
          )

          return { ...location, assignments: assignmentsWithItems.filter(a => a.item) }
        })
      )

      setLocations(locationsWithItems)

      // Get all active items for the request dropdown
      const { data: items } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .is('deleted_at', null)
        .order('name')

      setAllItems(items || [])
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }, [profile?.id, profile?.organization_id])

  useFocusEffect(
    useCallback(() => {
      fetchData()
    }, [fetchData])
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  const openRequestModal = (locationId?: string) => {
    setRequestForm({
      locationId: locationId || locations[0]?.id || '',
      itemId: allItems[0]?.id || '',
      quantity: 1,
      notes: '',
    })
    setRequestModalVisible(true)
  }

  const handleSubmitRequest = async () => {
    if (!profile?.id || !profile?.organization_id) return
    if (!requestForm.locationId || !requestForm.itemId || requestForm.quantity < 1) {
      alert('Please fill in all required fields')
      return
    }

    setSubmittingRequest(true)
    try {
      const { error } = await supabase.from('inventory_requests').insert({
        organization_id: profile.organization_id,
        location_id: requestForm.locationId,
        item_id: requestForm.itemId,
        quantity_requested: requestForm.quantity,
        notes: requestForm.notes || null,
        requested_by: profile.id,
      })

      if (error) throw error

      alert('Request submitted successfully!')
      setRequestModalVisible(false)
    } catch (error) {
      console.error('Error submitting request:', error)
      alert('Failed to submit request: ' + (error as Error).message)
    } finally {
      setSubmittingRequest(false)
    }
  }

  const openActionModal = (assignment: ItemAssignment & { item: InventoryItem }, location: Location) => {
    setSelectedAssignment(assignment)
    setSelectedLocation(location)
    setActionType('sale')
    setActionQuantity('1')
    setActionNotes('')
    setActionModalVisible(true)
  }

  const handleSubmitAction = async () => {
    if (!profile?.id || !selectedAssignment || !selectedLocation) return

    const qty = parseInt(actionQuantity)
    if (isNaN(qty) || qty < 1) {
      alert('Please enter a valid quantity')
      return
    }

    if (qty > (selectedAssignment.quantity_assigned || 0)) {
      alert('Quantity exceeds available stock')
      return
    }

    setSubmittingAction(true)
    try {
      // Record the action in location_history
      const quantityChange = actionType === 'restock' ? qty : -qty
      const newQuantity = (selectedAssignment.quantity_assigned || 0) + quantityChange

      const { error: historyError } = await supabase.from('location_history').insert({
        item_id: selectedAssignment.item_id,
        user_id: profile.id,
        action: actionType,
        quantity_change: quantityChange,
        quantity_after: newQuantity,
        location_name: selectedLocation.name,
        notes: actionNotes || null,
      })

      if (historyError) throw historyError

      // Update the assignment quantity
      const { error: updateError } = await supabase
        .from('item_assignments')
        .update({ quantity_assigned: newQuantity })
        .eq('id', selectedAssignment.id)

      if (updateError) throw updateError

      alert(`${LOCATION_ACTION_LABELS[actionType]} recorded successfully!`)
      setActionModalVisible(false)
      await fetchData()
    } catch (error) {
      console.error('Error recording action:', error)
      alert('Failed to record action: ' + (error as Error).message)
    } finally {
      setSubmittingAction(false)
    }
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
          <Text style={styles.title}>My Locations</Text>
          <Text style={styles.subtitle}>
            Manage inventory at your assigned locations
          </Text>
        </View>

        {locations.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📍</Text>
            <Text style={styles.emptyTitle}>No Locations Assigned</Text>
            <Text style={styles.emptyText}>
              You haven't been assigned to manage any locations yet.
              Contact your admin to get started.
            </Text>
          </View>
        ) : (
          <>
            {/* Request Button */}
            <TouchableOpacity
              style={styles.requestButton}
              onPress={() => openRequestModal()}
            >
              <Text style={styles.requestButtonText}>+ Request Items</Text>
            </TouchableOpacity>

            {/* Locations List */}
            {locations.map((location) => (
              <View key={location.id} style={styles.locationCard}>
                <View style={styles.locationHeader}>
                  <Text style={styles.locationName}>{location.name}</Text>
                  {location.address && (
                    <Text style={styles.locationAddress}>{location.address}</Text>
                  )}
                </View>

                {location.assignments.length === 0 ? (
                  <Text style={styles.noItemsText}>No items assigned yet</Text>
                ) : (
                  <View style={styles.itemsList}>
                    {location.assignments.map((assignment) => (
                      <TouchableOpacity
                        key={assignment.id}
                        style={styles.itemCard}
                        onPress={() => openActionModal(assignment, location)}
                      >
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemName}>{assignment.item.name}</Text>
                          {assignment.item.sku && (
                            <Text style={styles.itemSku}>SKU: {assignment.item.sku}</Text>
                          )}
                        </View>
                        <View style={styles.itemQuantity}>
                          <Text style={styles.quantityValue}>
                            {assignment.quantity_assigned || 0}
                          </Text>
                          <Text style={styles.quantityLabel}>in stock</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <TouchableOpacity
                  style={styles.locationRequestButton}
                  onPress={() => openRequestModal(location.id)}
                >
                  <Text style={styles.locationRequestButtonText}>Request for this location</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Request Modal */}
      <Modal
        visible={requestModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRequestModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Request Items</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Location</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={requestForm.locationId}
                  onValueChange={(value) => setRequestForm({ ...requestForm, locationId: value })}
                  style={styles.picker}
                >
                  {locations.map((loc) => (
                    <Picker.Item key={loc.id} label={loc.name} value={loc.id} />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Item</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={requestForm.itemId}
                  onValueChange={(value) => setRequestForm({ ...requestForm, itemId: value })}
                  style={styles.picker}
                >
                  {allItems.map((item) => (
                    <Picker.Item key={item.id} label={item.name} value={item.id} />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Quantity</Text>
              <TextInput
                style={styles.input}
                value={requestForm.quantity.toString()}
                onChangeText={(text) => setRequestForm({ ...requestForm, quantity: parseInt(text) || 0 })}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={COLORS.textSecondary}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={requestForm.notes}
                onChangeText={(text) => setRequestForm({ ...requestForm, notes: text })}
                placeholder="Reason for request..."
                placeholderTextColor={COLORS.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setRequestModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, submittingRequest && styles.buttonDisabled]}
                onPress={handleSubmitRequest}
                disabled={submittingRequest}
              >
                {submittingRequest ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Action Modal */}
      <Modal
        visible={actionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setActionModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Record Action</Text>
            {selectedAssignment && (
              <Text style={styles.modalSubtitle}>
                {selectedAssignment.item.name} at {selectedLocation?.name}
              </Text>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Action Type</Text>
              <View style={styles.actionButtons}>
                {(['sale', 'giveaway', 'restock', 'adjustment'] as LocationAction[]).map((action) => (
                  <TouchableOpacity
                    key={action}
                    style={[
                      styles.actionTypeButton,
                      actionType === action && styles.actionTypeButtonActive,
                    ]}
                    onPress={() => setActionType(action)}
                  >
                    <Text
                      style={[
                        styles.actionTypeButtonText,
                        actionType === action && styles.actionTypeButtonTextActive,
                      ]}
                    >
                      {LOCATION_ACTION_LABELS[action]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Quantity</Text>
              <TextInput
                style={styles.input}
                value={actionQuantity}
                onChangeText={setActionQuantity}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={COLORS.textSecondary}
              />
              {selectedAssignment && (
                <Text style={styles.inputHint}>
                  Available: {selectedAssignment.quantity_assigned || 0}
                </Text>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={actionNotes}
                onChangeText={setActionNotes}
                placeholder="Add notes..."
                placeholderTextColor={COLORS.textSecondary}
                multiline
                numberOfLines={2}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setActionModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, submittingAction && styles.buttonDisabled]}
                onPress={handleSubmitAction}
                disabled={submittingAction}
              >
                {submittingAction ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Record</Text>
                )}
              </TouchableOpacity>
            </View>
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
    marginBottom: 24,
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
    paddingHorizontal: 40,
  },
  requestButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  requestButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  locationCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  locationHeader: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  locationName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  locationAddress: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  noItemsText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
  },
  itemsList: {
    gap: 8,
  },
  itemCard: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  itemSku: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  itemQuantity: {
    alignItems: 'center',
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  quantityValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  quantityLabel: {
    fontSize: 10,
    color: COLORS.primary,
  },
  locationRequestButton: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  locationRequestButtonText: {
    fontSize: 14,
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
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  inputGroup: {
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
  inputHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  pickerContainer: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  picker: {
    color: COLORS.text,
  },
  actionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionTypeButton: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionTypeButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  actionTypeButtonText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  actionTypeButtonTextActive: {
    color: '#fff',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
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
    fontSize: 16,
    fontWeight: '600',
  },
  submitButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
})
