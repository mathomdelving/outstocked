import { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, router, Stack } from 'expo-router'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { COLORS } from '@/lib/constants'
import { UserProfile } from '@/types/database.types'

function BackButton() {
  return (
    <TouchableOpacity
      onPress={() => router.back()}
      style={{ marginRight: 16, padding: 4 }}
    >
      <Text style={{ fontSize: 24, color: COLORS.text }}>←</Text>
    </TouchableOpacity>
  )
}

export default function AdminUsersScreen() {
  const { profile } = useAuth()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Invite modal state
  const [inviteModalVisible, setInviteModalVisible] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  // Edit role modal state
  const [editRoleModalVisible, setEditRoleModalVisible] = useState(false)
  const [userToEdit, setUserToEdit] = useState<UserProfile | null>(null)
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user')
  const [updatingRole, setUpdatingRole] = useState(false)

  const fetchUsers = useCallback(async () => {
    if (!profile?.organization_id) {
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: true })

      if (error) throw error
      setUsers(data || [])
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setLoading(false)
    }
  }, [profile?.organization_id])

  useFocusEffect(
    useCallback(() => {
      fetchUsers()
    }, [fetchUsers])
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchUsers()
    setRefreshing(false)
  }

  const getInviteLink = () => {
    if (!profile?.organization_id) return ''
    return `https://outstocked.vercel.app/invite?org=${profile.organization_id}`
  }

  const handleCopyLink = async () => {
    const inviteLink = getInviteLink()
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteLink)
        setLinkCopied(true)
        setTimeout(() => setLinkCopied(false), 3000)
      }
    } catch (e) {
      // Clipboard might fail, show alert with link as fallback
      alert(`Copy this link:\n\n${inviteLink}`)
    }
  }

  const handleEditRole = (user: UserProfile) => {
    setUserToEdit(user)
    setNewRole(user.role)
    setEditRoleModalVisible(true)
  }

  const handleUpdateRole = async () => {
    if (!userToEdit) return

    // Prevent demoting yourself
    if (userToEdit.id === profile?.id && newRole !== 'admin') {
      alert('You cannot remove your own admin privileges')
      return
    }

    setUpdatingRole(true)
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ role: newRole })
        .eq('id', userToEdit.id)

      if (error) throw error

      alert('Role updated successfully')
      setEditRoleModalVisible(false)
      setUserToEdit(null)
      await fetchUsers()
    } catch (error) {
      console.error('Error updating role:', error)
      alert('Failed to update role: ' + (error as Error).message)
    } finally {
      setUpdatingRole(false)
    }
  }

  const renderUser = ({ item: user }: { item: UserProfile }) => (
    <TouchableOpacity
      style={styles.userCard}
      onPress={() => handleEditRole(user)}
      activeOpacity={0.7}
    >
      <View style={styles.userInfo}>
        <View style={styles.userNameRow}>
          <Text style={styles.userName}>
            {user.display_name || user.email.split('@')[0]}
          </Text>
          {user.id === profile?.id && (
            <View style={styles.youBadge}>
              <Text style={styles.youBadgeText}>You</Text>
            </View>
          )}
        </View>
        <Text style={styles.userEmail}>{user.email}</Text>
        <Text style={styles.userJoined}>
          Joined {new Date(user.created_at).toLocaleDateString()}
        </Text>
      </View>
      <View style={styles.userActions}>
        <View
          style={[
            styles.roleBadge,
            user.role === 'admin' && styles.roleBadgeAdmin,
          ]}
        >
          <Text
            style={[
              styles.roleBadgeText,
              user.role === 'admin' && styles.roleBadgeTextAdmin,
            ]}
          >
            {user.role === 'admin' ? 'Admin' : 'User'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  )

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Manage Users',
          headerLeft: () => <BackButton />,
        }}
      />
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Team Members</Text>
          <Text style={styles.headerSubtitle}>
            {users.length} member{users.length !== 1 ? 's' : ''} in your organization
          </Text>
        </View>

      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>
              {loading ? 'Loading...' : 'No team members'}
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setInviteModalVisible(true)}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Invite User Modal */}
      <Modal
        visible={inviteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Invite Team Member</Text>
            <Text style={styles.modalSubtitle}>
              Share this link with your team member. They'll create their own account and join your organization.
            </Text>

            <View style={styles.linkContainer}>
              <Text style={styles.linkText} numberOfLines={2} ellipsizeMode="middle">
                {getInviteLink()}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setInviteModalVisible(false)
                  setLinkCopied(false)
                }}
              >
                <Text style={styles.modalCancelButtonText}>Done</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalInviteButton, linkCopied && styles.modalButtonCopied]}
                onPress={handleCopyLink}
              >
                <Text style={styles.modalInviteButtonText}>
                  {linkCopied ? 'Copied!' : 'Copy Link'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Role Modal */}
      <Modal
        visible={editRoleModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditRoleModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Change Role</Text>
            <Text style={styles.modalSubtitle}>
              Update role for {userToEdit?.display_name || userToEdit?.email}
            </Text>

            <View style={styles.inputGroup}>
              <View style={styles.roleSelector}>
                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    newRole === 'user' && styles.roleOptionActive,
                  ]}
                  onPress={() => setNewRole('user')}
                >
                  <Text
                    style={[
                      styles.roleOptionText,
                      newRole === 'user' && styles.roleOptionTextActive,
                    ]}
                  >
                    User
                  </Text>
                  <Text style={styles.roleDescription}>
                    Can view and update assigned items
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    newRole === 'admin' && styles.roleOptionActive,
                  ]}
                  onPress={() => setNewRole('admin')}
                >
                  <Text
                    style={[
                      styles.roleOptionText,
                      newRole === 'admin' && styles.roleOptionTextActive,
                    ]}
                  >
                    Admin
                  </Text>
                  <Text style={styles.roleDescription}>
                    Full access to all features
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setEditRoleModalVisible(false)
                  setUserToEdit(null)
                }}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveButton, updatingRole && styles.modalButtonDisabled]}
                onPress={handleUpdateRole}
                disabled={updatingRole}
              >
                <Text style={styles.modalSaveButtonText}>
                  {updatingRole ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </SafeAreaView>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  userCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  userInfo: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  youBadge: {
    backgroundColor: COLORS.primary + '30',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  youBadgeText: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '600',
  },
  userEmail: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  userJoined: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  userActions: {
    alignItems: 'flex-end',
  },
  roleBadge: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  roleBadgeAdmin: {
    backgroundColor: COLORS.primary + '20',
  },
  roleBadgeText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  roleBadgeTextAdmin: {
    color: COLORS.primary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabText: {
    fontSize: 28,
    color: '#fff',
    fontWeight: '300',
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
    borderWidth: 1,
    borderColor: COLORS.border,
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
  roleSelector: {
    gap: 8,
  },
  roleOption: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  roleOptionActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  roleOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  roleOptionTextActive: {
    color: COLORS.primary,
  },
  roleDescription: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalCancelButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  modalInviteButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonCopied: {
    backgroundColor: '#22c55e',
  },
  modalInviteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkContainer: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  linkText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
  },
  modalSaveButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalSaveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
})
