// Use local proxy to avoid CORS issues
const API_BASE = '/api/proxy';

// Types matching the gateway schemas
export interface Task {
  id: string;
  user_id: string;
  capability: string;
  status: string;
  opportunity_id: string | null;
  booking_id: string | null;
  priority: string;
  request_data: Record<string, unknown>;
  response_data: Record<string, unknown> | null;
  outcome: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  blocked_reason: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

export interface Escalation {
  id: string;
  user_id: string;
  type: string;
  source_type: string;
  source_id: string | null;
  reason: string;
  priority: string;
  status: string;
  context: Record<string, unknown> | null;
  claimed_by: string | null;
  claimed_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EscalationListResponse {
  escalations: Escalation[];
  total: number;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        // TODO: Add real auth token when OAuth is implemented
        'Authorization': 'Bearer mock-token',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  // Tasks
  async listTasks(params?: {
    status?: string;
    capability?: string;
    limit?: number;
  }): Promise<TaskListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.capability) searchParams.set('capability', params.capability);
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return this.fetch<TaskListResponse>(`/tasks/${query ? `?${query}` : ''}`);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.fetch<Task>(`/tasks/${taskId}`);
  }

  async claimTask(taskId: string): Promise<Task> {
    return this.fetch<Task>(`/tasks/${taskId}/claim`, { method: 'POST' });
  }

  async blockTask(taskId: string, reason: string): Promise<Task> {
    return this.fetch<Task>(`/tasks/${taskId}/block`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async completeTask(
    taskId: string,
    outcome: string,
    responseData: Record<string, unknown>
  ): Promise<Task> {
    return this.fetch<Task>(`/tasks/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ outcome, response_data: responseData }),
    });
  }

  // Escalations
  async listEscalations(params?: {
    user_id?: string;
    limit?: number;
  }): Promise<EscalationListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.user_id) searchParams.set('user_id', params.user_id);
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return this.fetch<EscalationListResponse>(`/escalations/${query ? `?${query}` : ''}`);
  }

  async getEscalation(escalationId: string): Promise<Escalation> {
    return this.fetch<Escalation>(`/escalations/${escalationId}`);
  }

  async claimEscalation(escalationId: string): Promise<Escalation> {
    return this.fetch<Escalation>(`/escalations/${escalationId}/claim`, { method: 'POST' });
  }

  async resolveEscalation(escalationId: string, resolutionNotes: string): Promise<Escalation> {
    return this.fetch<Escalation>(`/escalations/${escalationId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution_notes: resolutionNotes }),
    });
  }

  // Members
  // Note: Backend doesn't support search param - filtering is done client-side
  async listMembers(params?: {
    skip?: number;
    limit?: number;
  }): Promise<MemberListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.skip) searchParams.set('skip', params.skip.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return this.fetch<MemberListResponse>(`/members/${query ? `?${query}` : ''}`);
  }

  async getMember(userId: string): Promise<MemberContext> {
    return this.fetch<MemberContext>(`/members/${userId}`);
  }
}

export interface MemberSummary {
  id: string;
  email: string | null;
  phone_number: string | null;
  name: string | null;
  status: string;
  membership_status: string | null;
  membership_plan: string | null;
  created_at: string;
  has_active_escalation: boolean;
  pending_opportunities: number;
}

export interface MemberListResponse {
  members: MemberSummary[];
  total: number;
  skip: number;
  limit: number;
}

// Full member context - structure from operator_context endpoint
export interface MemberContext {
  user: unknown;
  user_context: unknown;
  user_extras: {
    id: string;
    email: string | null;
    phone: string | null;
    created_at: string;
    stripe_customer_id: string | null;
    membership_expires_at: string | null;
  };
  travellers: unknown[];
  trips: unknown[];
  airline_credits: unknown[];
  watches: unknown[];
  flight_opportunities: unknown[];
  hotel_opportunities: unknown[];
  communications: unknown[];
  pending_payments: unknown[];
  pending_tasks: unknown[];
  escalations: unknown[];
  payment_records: unknown[];
  referral_stats: unknown;
}

export const api = new ApiClient(API_BASE);
