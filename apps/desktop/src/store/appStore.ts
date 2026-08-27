import { create } from 'zustand';
import type { AuthResponse, UpdateProfileRequest } from '@guilda/types/api';
import type { Channel, GuildServer, PresenceStatus, User } from '@guilda/types/entities';
import { ApiRequestError, api } from '../lib/api';
import { tokenStore } from '../lib/tokenStore';

let loadRequestId = 0;
let selectionRequestId = 0;

interface AuthState {
  user: User | null;
  hydrated: boolean;
  busy: boolean;
  error: string | null;
  clearError(): void;
  hydrate(): Promise<void>;
  login(email: string, password: string, persistSession: boolean): Promise<void>;
  updateProfile(input: UpdateProfileRequest): Promise<void>;
  register(
    input: {
      username: string;
      displayName: string;
      email: string;
      password: string;
    },
    persistSession: boolean,
  ): Promise<void>;
  logout(): Promise<void>;
}
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  hydrated: false,
  busy: false,
  error: null,
  clearError() {
    set({ error: null });
  },
  async hydrate() {
    let refreshToken: string | null = null;
    try {
      const tokens = await tokenStore.get();
      refreshToken = tokens?.refreshToken ?? null;
      if (!tokens) {
        useWorkspaceStore.getState().reset();
        set({ user: null, error: null });
        return;
      }

      const user = await api.getCurrentUser();
      const currentUserId = useAuthStore.getState().user?.id;
      if (currentUserId && currentUserId !== user.id) useWorkspaceStore.getState().reset();
      set({ user, error: null });
    } catch (error) {
      const definitiveAuthFailure = error instanceof ApiRequestError && error.status === 401;
      if (definitiveAuthFailure && refreshToken) {
        const current = await tokenStore.get().catch(() => null);
        if (current && current.refreshToken !== refreshToken) return;
        if (current?.refreshToken === refreshToken) await tokenStore.clear().catch(() => undefined);
        useWorkspaceStore.getState().reset();
        set({ user: null });
      }
      set({ error: error instanceof Error ? error.message : 'Unable to restore your session.' });
    } finally {
      set({ hydrated: true });
    }
  },
  async login(email, password, persistSession) {
    set({ busy: true, error: null });
    try {
      const result = await api.login({ email, password });
      await tokenStore.set(result, persistSession);
      useWorkspaceStore.getState().reset();
      set({ user: result.user });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Sign in failed.' });
      throw error;
    } finally {
      set({ busy: false });
    }
  },
  async updateProfile(input) {
    set({ busy: true, error: null });
    try {
      const user = await api.updateProfile(input);
      set({ user });
      useWorkspaceStore.getState().updateUser(user);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Profile update failed.' });
      throw error;
    } finally {
      set({ busy: false });
    }
  },
  async register(input, persistSession) {
    set({ busy: true, error: null });
    try {
      const result = await api.register(input);
      await tokenStore.set(result, persistSession);
      useWorkspaceStore.getState().reset();
      set({ user: result.user });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Account creation failed.' });
      throw error;
    } finally {
      set({ busy: false });
    }
  },
  async logout() {
    set({ busy: true, error: null });
    useWorkspaceStore.getState().reset();
    set({ user: null, error: null });
    try {
      await api.logout();
    } catch {
      // Local session state is already cleared; remote revocation is best effort.
    } finally {
      set({ busy: false });
    }
  },
}));

interface WorkspaceState {
  servers: GuildServer[];
  activeServer: GuildServer | null;
  channels: Channel[];
  members: User[];
  activeChannelId: string | null;
  currentUserPermissions: number;
  isLoading: boolean;
  error: string | null;
  load(): Promise<void>;
  selectServer(server: GuildServer): Promise<void>;
  selectChannel(activeChannelId: string | null): void;
  addChannel(channel: Channel): void;
  addServer(server: GuildServer): void;
  updatePresence(userId: string, status: PresenceStatus): void;
  updateUser(user: User): void;
  upsertMember(user: User): void;
  removeMember(userId: string): void;
  updateMemberPermissions(serverId: string, userId: string, permissions: number): void;
  refreshMembers(serverId: string): Promise<void>;
  reset(): void;
}
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  servers: [],
  activeServer: null,
  channels: [],
  members: [],
  activeChannelId: null,
  currentUserPermissions: 0,
  isLoading: false,
  error: null,
  async load() {
    const requestId = ++loadRequestId;
    set({ isLoading: true, error: null });
    try {
      const servers = await api.getServers();
      if (requestId !== loadRequestId) return;
      set({ servers });
      if (servers[0]) {
        await get().selectServer(servers[0]);
      } else {
        set({
          activeServer: null,
          channels: [],
          members: [],
          activeChannelId: null,
          currentUserPermissions: 0,
          isLoading: false,
        });
      }
    } catch (error) {
      if (requestId !== loadRequestId) return;
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Could not load your spaces.',
      });
    }
  },
  async selectServer(server) {
    loadRequestId += 1;
    const requestId = ++selectionRequestId;
    set({
      activeServer: server,
      channels: [],
      members: [],
      activeChannelId: null,
      currentUserPermissions: 0,
      isLoading: true,
      error: null,
    });
    try {
      const snapshot = await api.getServerSnapshot(server.id);
      if (requestId !== selectionRequestId || get().activeServer?.id !== server.id) return;
      const channels = [...snapshot.channels].sort((a, b) => a.position - b.position);
      set({
        channels,
        members: snapshot.members,
        currentUserPermissions: snapshot.currentUserPermissions,
        activeChannelId: channels[0]?.id ?? null,
        isLoading: false,
      });
    } catch (error) {
      if (requestId !== selectionRequestId || get().activeServer?.id !== server.id) return;
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Could not load this space.',
      });
    }
  },
  selectChannel(activeChannelId) {
    set({ activeChannelId });
  },
  addChannel(channel) {
    set((state) => ({ channels: [...state.channels, channel] }));
  },
  addServer(server) {
    set((state) => ({
      servers: state.servers.some((candidate) => candidate.id === server.id)
        ? state.servers.map((candidate) => (candidate.id === server.id ? server : candidate))
        : [...state.servers, server],
      activeServer: server,
    }));
  },
  updatePresence(userId, status) {
    set((state) => ({
      members: state.members.map((member) =>
        member.id === userId ? { ...member, status } : member,
      ),
    }));
  },
  updateUser(user) {
    set((state) => ({
      members: state.members.map((member) => (member.id === user.id ? user : member)),
    }));
  },
  upsertMember(user) {
    set((state) => ({
      members: state.members.some((member) => member.id === user.id)
        ? state.members.map((member) => (member.id === user.id ? user : member))
        : [...state.members, user],
    }));
  },
  removeMember(userId) {
    set((state) => ({ members: state.members.filter((member) => member.id !== userId) }));
  },
  updateMemberPermissions(serverId, userId, permissions) {
    set((state) =>
      state.activeServer?.id === serverId && useAuthStore.getState().user?.id === userId
        ? { currentUserPermissions: permissions }
        : {},
    );
  },
  async refreshMembers(serverId) {
    const snapshot = await api.getServerSnapshot(serverId);
    set((state) =>
      state.activeServer?.id === serverId
        ? {
            members: snapshot.members,
            currentUserPermissions: snapshot.currentUserPermissions,
          }
        : {},
    );
  },
  reset() {
    loadRequestId += 1;
    selectionRequestId += 1;
    set({
      servers: [],
      activeServer: null,
      channels: [],
      members: [],
      activeChannelId: null,
      currentUserPermissions: 0,
      isLoading: false,
      error: null,
    });
  },
}));

export type AuthResult = AuthResponse;
