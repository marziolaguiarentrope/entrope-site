// Use local proxy to avoid CORS issues
const API_BASE = '/api/proxy';
const FETCH_TIMEOUT = 180000; // 180 seconds — wake calls run LLM + flight searches on large trips

export class ApiError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(`API error ${status}: ${message}`);
    this.status = status;
    this.name = 'ApiError';
  }
}

// Types matching the gateway schemas

// Passenger info from FlightBookingResponse
export interface PassengerSummary {
  id: string | null;
  name: string;
  is_primary: boolean;
  date_of_birth: string | null;
  citizenship: string | null;
}

// Hydrated flight booking details from admin gateway
export interface FlightBookingDetail {
  id: string;
  user_id: string;
  status: string;
  verification_status?: string | null;
  source: string;
  conv_trip_id?: string | null;
  source_email_id?: string | null;
  booking_channel: string | null;
  booking_provider: string | null;
  airline: string | null;
  airline_code: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  travel_begins_date?: string | null;
  cabin_class: string | null;
  cash_paid: { amount: number; currency: string } | null;
  supplier_cost?: { amount: number; currency: string } | null;
  margin?: { amount: number; currency: string } | null;
  original_price?: { amount: number; currency: string } | null;
  total_savings?: { amount: number; currency: string } | null;
  supplier?: string | null;
  internal_supplier_reference?: string | null;
  access_credentials?: Record<string, unknown> | null;
  itinerary?: Record<string, unknown> | null;
  tickets?: Record<string, unknown>[];
  ancillaries?: Record<string, unknown>[];
  is_award_booking?: boolean;
  loyalty_program?: string | null;
  loyalty_number?: string | null;
  miles_paid?: number | null;
  record_locator: string | null;
  booked_at: string | null;
  passengers: PassengerSummary[];
  created_at: string;
  updated_at: string;
}

// Guest info from HotelBookingResponse
export interface GuestSummary {
  id: string | null;
  name: string;
  is_primary: boolean;
  date_of_birth: string | null;
  citizenship: string | null;
}

// Hydrated hotel booking details from admin gateway
export interface HotelBookingDetail {
  id: string;
  user_id: string;
  status: string;
  source: string;
  source_email_id?: string | null;
  hotel_name: string | null;
  hotel_chain: string | null;
  hotel_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  room_type: string | null;
  number_of_rooms: number | null;
  cash_paid: { amount: number; currency: string } | null;
  special_requests: string | null;
  cancellation_policy: string | null;
  free_cancellation_until: string | null;
  confirmation_number: string | null;
  booking_provider: string | null;
  axel_can_cancel: boolean | null;
  is_award_booking: boolean;
  loyalty_program: string | null;
  loyalty_number: string | null;
  points_paid: number | null;
  guests: GuestSummary[];
  created_at: string;
  updated_at: string;
}

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
  scheduled_for: string | null;
  completed_at: string | null;
  created_at: string;
  valid_failure_reasons: string[];
  flight_booking: FlightBookingDetail | null;
  hotel_booking: HotelBookingDetail | null;
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

export type PendingEmailApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PendingEmail {
  id: string;
  user_id: string;
  template_id?: string | null;
  to_email: string | null;
  to_name: string | null;
  subject: string | null;
  preheader: string | null;
  body: string;
  status: string;
  approval_status: PendingEmailApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  loop_record_id: string | null;
  idempotency_key: string | null;
  created_at: string;
  sent_at: string | null;
  provider_message_id?: string | null;
  error_message?: string | null;
}

export interface PendingEmailListResponse {
  items: PendingEmail[];
  total: number;
  limit: number;
  offset: number;
}

export interface PendingEmailBrainReasoning {
  headline: string | null;
  intent_summary: string | null;
  triggered_at: string | null;
}

export interface PendingEmailDetail {
  message: PendingEmail;
  brain_reasoning: PendingEmailBrainReasoning | null;
  recent_communications: CommunicationView[];
  member_url: string | null;
}

export type PendingSmsApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PendingSms {
  id: string;
  user_id: string;
  to_phone: string | null;
  to_name: string | null;
  body: string | null;
  status: string;
  approval_status: PendingSmsApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  loop_record_id: string | null;
  idempotency_key: string | null;
  created_at: string;
  sent_at: string | null;
  provider_message_id?: string | null;
  error_message?: string | null;
}

export interface PendingSmsListResponse {
  items: PendingSms[];
  total: number;
  limit: number;
  offset: number;
}

export interface PendingSmsBrainReasoning {
  headline: string | null;
  intent_summary: string | null;
  triggered_at: string | null;
}

export interface PendingSmsDetail {
  message: PendingSms;
  brain_reasoning: PendingSmsBrainReasoning | null;
  recent_communications: CommunicationView[];
  member_url: string | null;
}

export interface InboundSms {
  id: string;
  user_id: string;
  from_phone: string | null;
  from_name: string | null;
  body: string | null;
  provider_message_id: string | null;
  created_at: string;
}

export interface InboundSmsListResponse {
  items: InboundSms[];
  total: number;
  limit: number;
  offset: number;
}

export type FlightConversionTaskStatus = 'pending' | 'claimed' | 'blocked' | 'completed' | 'failed';

export interface FlightConversionSummary {
  quote_request_id: string | null;
  origin: string | null;
  destination: string | null;
  departure_date: string | null;
  return_date: string | null;
  cabin: string | null;
  passengers: number | null;
  best_axel_savings_cents: number | null;
  converted_at: string | null;
}

export interface FlightConversionListItem {
  task: Task;
  summary: FlightConversionSummary;
}

export interface FlightConversionListResponse {
  items: FlightConversionListItem[];
  total: number;
}

export type AgentFlightBookingTaskStatus = 'pending' | 'claimed' | 'blocked' | 'completed' | 'failed';

export interface AgentFlightBookingTraveler {
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  [key: string]: unknown;
}

export interface AgentFlightBookingSegment {
  origin: string | null;
  destination: string | null;
  departure_date: string | null;
  departure_time: string | null;
  arrival_date: string | null;
  arrival_time: string | null;
  flight_number: string | null;
  operating_carrier: string | null;
  marketing_carrier: string | null;
  marketing_flight_number: string | null;
  cabin: string | null;
  fare_family: string | null;
}

export interface AgentFlightBookingSummary {
  booking_id: string | null;
  booking_status: string | null;
  record_locator: string | null;
  booking_provider: string | null;
  origin: string | null;
  destination: string | null;
  outbound_departure: string | null;
  return_departure: string | null;
  trip_type: string | null;
  carrier_code: string | null;
  carrier_name: string | null;
  flight_numbers: string[];
  traveler_count: number;
  travelers: AgentFlightBookingTraveler[];
  cabin: string | null;
  fare_family: string | null;
  segments: AgentFlightBookingSegment[];
  price_paid_cents: number | null;
  currency: string | null;
  user_id: string;
}

export interface AgentFlightBookingListItem {
  task: Task;
  summary: AgentFlightBookingSummary;
}

export interface AgentFlightBookingListResponse {
  items: AgentFlightBookingListItem[];
  total: number;
}

export interface AgentFlightBookingUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  phone_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  timezone?: string | null;
  auto_reprice_flights?: boolean;
  auto_reprice_hotels?: boolean;
  action_threshold_usd?: number | null;
  quiet_hours_start?: number | null;
  quiet_hours_end?: number | null;
  sms_opted_in?: boolean;
  sms_opted_out?: boolean;
  email_verified?: boolean;
  email_bouncing?: boolean;
  phone_verified?: boolean;
  forwarding_slug?: string | null;
  reply_slug?: string | null;
  verified_emails?: string[];
  status?: string | null;
  member_since?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  date_of_birth?: string | null;
  [key: string]: unknown;
}

export interface AgentFlightBookingDetail {
  task: Task;
  summary: AgentFlightBookingSummary;
  flight_booking: FlightBookingDetail | null;
  user: AgentFlightBookingUser | null;
  traveler_profiles?: TravelerProfile[] | null;
}

export interface FlightResultLegSnapshot {
  stops: number;
  duration_minutes: number | null;
  departure_time: string | null;
  arrival_time: string | null;
  flight_numbers: string[];
  stop_cities: string[];
}

export interface FlightResultSnapshot {
  price_cents: number;
  axel_price_cents: number | null;
  axel_savings_cents: number | null;
  currency: string;
  carriers: string[];
  carrier_names: Record<string, string>;
  outbound: FlightResultLegSnapshot | null;
  return: FlightResultLegSnapshot | null;
}

export interface PriceInsightsSnapshot {
  price_level: string | null;
  typical_low_cents: number | null;
  typical_high_cents: number | null;
  price_history: { date: string; price_cents: number }[] | null;
  cheapest_price_cents: number | null;
  hold_target_cents: number | null;
  is_fallback: boolean;
  user_target_price_cents?: number | null;
  user_target_currency?: string | null;
  user_target_set_at?: string | null;
  selected_result_index?: number | null;
  selected_result_set_at?: string | null;
  selected_result_source?: string | null;
  selected_result_snapshot?: FlightResultSnapshot | null;
}

export interface FlightConversionFulfillmentContext {
  quote_request_id: string;
  origin: string | null;
  destination: string | null;
  departure_date: string | null;
  return_date: string | null;
  cabin: string | null;
  passengers: number | null;
  results_snapshot: FlightResultSnapshot[] | null;
  price_insights_snapshot: PriceInsightsSnapshot | null;
  created_at: string;
  updated_at: string;
}

export interface FlightConversionUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  phone_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

export interface FlightConversionDetail {
  task: Task;
  user: FlightConversionUser | null;
  quote_request_id: string;
  fulfillment_context: FlightConversionFulfillmentContext | null;
  recent_communications: CommunicationView[];
}

export interface FlightConversionSendMessageResponse {
  message_id: string | null;
  status: string;
  approval_status: string | null;
  provider_message_id: string | null;
  error: string | null;
}

export interface OperatorAxelMessageSendResponse {
  message_id: string | null;
  status: string;
  approval_status: string | null;
  provider_message_id: string | null;
  error: string | null;
}

export interface OperatorAxelSmsSendResponse {
  message_id: string | null;
  status: string;
  approval_status: string | null;
  provider_message_id: string | null;
  error: string | null;
}

export interface DraftMemberAxelSmsResponse {
  status: string;
  trip_id: string;
  message_id: string | null;
  response: string;
  error: string | null;
}

export interface ConversationalTrip {
  id: string;
  name?: string | null;
  destination?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  archived?: boolean;
  bookings?: unknown[];
  bookings_count?: number | null;
  [key: string]: unknown;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async fetchOnce<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (response.status === 401) {
        // Session expired — notify the auth context to redirect to login
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
        throw new ApiError(401, 'Session expired');
      }

      if (!response.ok) {
        const error = await response.text();
        throw new ApiError(response.status, error);
      }

      return response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(0, `Request timed out after ${FETCH_TIMEOUT / 1000} seconds — the backend may be waking up, please retry`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch with automatic retry on transient server errors (500/502/503/504).
   * Uses exponential backoff: 2s → 4s between retries, up to 2 retries.
   */
  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 2000; // 2 seconds

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.fetchOnce<T>(path, options);
      } catch (error) {
        lastError = error;
        const isRetryable =
          error instanceof ApiError &&
          [500, 502, 503, 504].includes(error.status);

        if (!isRetryable || attempt === MAX_RETRIES) {
          throw error;
        }

        // Exponential backoff: 2s, 4s
        const delay = BASE_DELAY * Math.pow(2, attempt);
        console.warn(
          `[api] Retrying ${options?.method || 'GET'} ${path} (attempt ${attempt + 1}/${MAX_RETRIES}) after ${delay}ms — got ${(error as ApiError).status}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  // Tasks
  async listTasks(params?: {
    status?: string;
    capability?: string;
    limit?: number;
    skip?: number;
  }): Promise<TaskListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.capability) searchParams.set('capability', params.capability);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.skip) searchParams.set('skip', params.skip.toString());

    const query = searchParams.toString();
    return this.fetch<TaskListResponse>(`/tasks/${query ? `?${query}` : ''}`);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.fetch<Task>(`/tasks/${taskId}`);
  }

  async claimTask(taskId: string): Promise<Task> {
    return this.fetch<Task>(`/tasks/${taskId}/claim`, { method: 'POST' });
  }

  async unclaimTask(taskId: string): Promise<Task> {
    return this.fetch<Task>(`/tasks/${taskId}/unclaim`, { method: 'POST' });
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
    status?: string[];
    limit?: number;
  }): Promise<EscalationListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.user_id) searchParams.set('user_id', params.user_id);
    if (params?.status) {
      params.status.forEach(s => searchParams.append('status', s));
    }
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

  // Pending email approvals
  async listPendingEmails(params?: {
    status?: PendingEmailApprovalStatus;
    templateId?: string;
    limit?: number;
    offset?: number;
  }): Promise<PendingEmailListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.templateId) searchParams.set('template_id', params.templateId);
    if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.fetch<PendingEmailListResponse>(`/pending-emails${query ? `?${query}` : ''}`);
  }

  async getPendingEmailDetail(id: string): Promise<PendingEmailDetail> {
    return this.fetch<PendingEmailDetail>(`/pending-emails/${id}`);
  }

  async approvePendingEmail(id: string): Promise<PendingEmail> {
    return this.fetch<PendingEmail>(`/pending-emails/${id}/approve`, { method: 'POST' });
  }

  async rejectPendingEmail(id: string, reason: string): Promise<PendingEmail> {
    return this.fetch<PendingEmail>(`/pending-emails/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Pending SMS approvals
  async listPendingSms(params?: {
    status?: PendingSmsApprovalStatus;
    limit?: number;
    offset?: number;
  }): Promise<PendingSmsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.fetch<PendingSmsListResponse>(`/pending-sms${query ? `?${query}` : ''}`);
  }

  async getPendingSmsDetail(id: string): Promise<PendingSmsDetail> {
    return this.fetch<PendingSmsDetail>(`/pending-sms/${id}`);
  }

  async approvePendingSms(id: string): Promise<PendingSms> {
    return this.fetch<PendingSms>(`/pending-sms/${id}/approve`, { method: 'POST' });
  }

  async rejectPendingSms(id: string, reason: string): Promise<PendingSms> {
    return this.fetch<PendingSms>(`/pending-sms/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async listInboundSms(params?: {
    limit?: number;
    offset?: number;
  }): Promise<InboundSmsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.fetch<InboundSmsListResponse>(`/pending-sms/inbound${query ? `?${query}` : ''}`);
  }

  // Flight watch conversions (operator fulfillment)
  async listFlightConversions(params?: {
    status?: FlightConversionTaskStatus;
    limit?: number;
    offset?: number;
  }): Promise<FlightConversionListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.fetch<FlightConversionListResponse>(`/flight-conversions/${query ? `?${query}` : ''}`);
  }

  async getFlightConversionDetail(taskId: string): Promise<FlightConversionDetail> {
    return this.fetch<FlightConversionDetail>(`/flight-conversions/${taskId}`);
  }

  async sendFlightConversionMessage(
    taskId: string,
    data: {
      body: string;
      subject?: string;
      idempotency_key?: string;
    },
  ): Promise<FlightConversionSendMessageResponse> {
    return this.fetch<FlightConversionSendMessageResponse>(`/flight-conversions/${taskId}/send-message`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async claimFlightConversionTask(taskId: string): Promise<Task> {
    return this.fetch<Task>(`/flight-conversions/${taskId}/claim`, { method: 'POST' });
  }

  async unclaimFlightConversionTask(taskId: string): Promise<Task> {
    return this.fetch<Task>(`/flight-conversions/${taskId}/unclaim`, { method: 'POST' });
  }

  async blockFlightConversionTask(taskId: string, reason: string): Promise<Task> {
    return this.fetch<Task>(`/flight-conversions/${taskId}/block`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async completeFlightConversionTask(
    taskId: string,
    data: {
      outcome: 'success' | 'partial' | 'failure';
      fulfillment_outcome?: string;
      contacted_via?: string;
      message_ids?: string[];
      notes?: string;
    },
  ): Promise<Task> {
    return this.fetch<Task>(`/flight-conversions/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Agent flight booking fulfillment
  async listAgentFlightBookings(params?: {
    status?: AgentFlightBookingTaskStatus;
    limit?: number;
    offset?: number;
    q?: string;
  }): Promise<AgentFlightBookingListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());
    if (params?.q) searchParams.set('q', params.q);

    const query = searchParams.toString();
    return this.fetch<AgentFlightBookingListResponse>(`/agent-flight-bookings/${query ? `?${query}` : ''}`);
  }

  async getAgentFlightBookingDetail(taskId: string): Promise<AgentFlightBookingDetail> {
    return this.fetch<AgentFlightBookingDetail>(`/agent-flight-bookings/${taskId}`);
  }

  async claimAgentFlightBookingTask(taskId: string): Promise<Task> {
    return this.fetch<Task>(`/agent-flight-bookings/${taskId}/claim`, { method: 'POST' });
  }

  async unclaimAgentFlightBookingTask(taskId: string): Promise<Task> {
    return this.fetch<Task>(`/agent-flight-bookings/${taskId}/unclaim`, { method: 'POST' });
  }

  async blockAgentFlightBookingTask(taskId: string, reason: string): Promise<Task> {
    return this.fetch<Task>(`/agent-flight-bookings/${taskId}/block`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async completeAgentFlightBookingTask(
    taskId: string,
    data: {
      outcome: 'success' | 'partial' | 'failure';
      airline_confirmation_code?: string;
      booking_provider?: string;
      failure_reason?: string;
      notes?: string;
    },
  ): Promise<Task> {
    return this.fetch<Task>(`/agent-flight-bookings/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // FAC-239: Failed tasks can now be claimed (→ claimed), then completed/blocked via normal flow.

  // Hotel Opportunity Actions
  async confirmBooking(
    opportunityId: string,
    supplier: string,
    internalSupplierReference: string,
    supplierCostAmount?: number,
    supplierCostCurrency?: string,
  ): Promise<{ status: string }> {
    const body: Record<string, unknown> = {
      supplier,
      internal_supplier_reference: internalSupplierReference,
    };
    if (supplierCostAmount !== undefined) body.supplier_cost_amount = supplierCostAmount;
    if (supplierCostCurrency) body.supplier_cost_currency = supplierCostCurrency;

    return this.fetch<{ status: string }>(`/hotel-opportunities/${opportunityId}/confirm-booking`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Cancel a repricing opportunity. Backend endpoint pending deployment (FAC ticket).
   * Will return 404 until backend implements POST /hotel-opportunities/{id}/cancel.
   */
  async cancelOpportunity(opportunityId: string, reason: string): Promise<{ status: string }> {
    return this.fetch<{ status: string }>(`/hotel-opportunities/${opportunityId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Members
  async searchMemberByEmail(email: string): Promise<MemberSummary | null> {
    return this.fetch<MemberSummary | null>(`/members/search?email=${encodeURIComponent(email)}`);
  }

  async searchMemberByPhone(phone: string): Promise<MemberSummary | null> {
    return this.fetch<MemberSummary | null>(`/members/search?phone=${encodeURIComponent(phone)}`);
  }

  async searchMember(query: string): Promise<MemberSummary | null> {
    // Detect if query looks like a phone number (starts with + or contains only digits/spaces/dashes)
    const isPhone = /^[\d\s\-+()]+$/.test(query.trim()) && query.trim().length >= 10;
    if (isPhone) {
      return this.searchMemberByPhone(query.trim());
    }
    return this.searchMemberByEmail(query.trim());
  }

  async sendMemberAxelMessage(
    userId: string,
    data: {
      body: string;
      subject?: string;
      idempotency_key?: string;
    },
  ): Promise<OperatorAxelMessageSendResponse> {
    return this.fetch<OperatorAxelMessageSendResponse>(`/members/${userId}/send-axel-message`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listMemberConvTrips(userId: string): Promise<ConversationalTrip[]> {
    const result = await this.fetch<
      ConversationalTrip[] | { items?: ConversationalTrip[]; trips?: ConversationalTrip[] }
    >(`/members/${userId}/conv-trips`);

    if (Array.isArray(result)) return result;
    if (Array.isArray(result.items)) return result.items;
    if (Array.isArray(result.trips)) return result.trips;
    return [];
  }

  async draftMemberAxelSms(
    userId: string,
    tripId: string,
    data: {
      guidance?: string;
      idempotency_key?: string;
    },
  ): Promise<DraftMemberAxelSmsResponse> {
    return this.fetch<DraftMemberAxelSmsResponse>(`/members/${userId}/conv-trips/${tripId}/draft-axel-sms`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async sendMemberAxelSms(
    userId: string,
    tripId: string,
    data: {
      body: string;
      idempotency_key?: string;
    },
  ): Promise<OperatorAxelSmsSendResponse> {
    return this.fetch<OperatorAxelSmsSendResponse>(`/members/${userId}/conv-trips/${tripId}/send-axel-sms`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMember(userId: string): Promise<MemberContext> {
    return this.fetch<MemberContext>(`/members/${userId}`);
  }

  async updateMemberEmail(userId: string, data: UpdateMemberEmailRequest): Promise<UpdateMemberEmailResponse> {
    return this.fetch<UpdateMemberEmailResponse>(`/members/${userId}/update-email`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateMemberName(userId: string, data: UpdateMemberNameRequest): Promise<UpdateMemberNameResponse> {
    return this.fetch<UpdateMemberNameResponse>(`/members/${userId}/update-name`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** Permanently delete all member data across all services. This is IRREVERSIBLE. */
  async deleteMemberData(userId: string): Promise<DeleteMemberDataResponse> {
    return this.fetch<DeleteMemberDataResponse>(`/members/${userId}/data`, {
      method: 'DELETE',
    });
  }

  /** Refund a member's most recent membership payment. Supports full or partial refund. */
  async refundMembership(userId: string, data: RefundMembershipRequest): Promise<RefundMembershipResponse> {
    return this.fetch<RefundMembershipResponse>(`/members/${userId}/refund`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** Skip the member's next annual renewal (pauses billing for 1 year). */
  async skipRenewal(userId: string): Promise<SkipRenewalResponse> {
    return this.fetch<SkipRenewalResponse>(`/members/${userId}/skip-renewal`, {
      method: 'POST',
    });
  }

  /** Suspend a member account (cuts access but preserves data). */
  async suspendMember(userId: string): Promise<SuspendMemberResponse> {
    return this.fetch<SuspendMemberResponse>(`/members/${userId}/suspend`, {
      method: 'POST',
    });
  }

  /** Unsuspend a previously suspended member account. */
  async unsuspendMember(userId: string): Promise<UnsuspendMemberResponse> {
    return this.fetch<UnsuspendMemberResponse>(`/members/${userId}/unsuspend`, {
      method: 'POST',
    });
  }

  /** Lightweight user info (email, phone, name) extracted from full member context */
  async getUserBasicInfo(userId: string): Promise<UserBasicInfo> {
    const ctx = await this.getMember(userId);
    return {
      id: userId,
      email: ctx.user_extras?.email ?? null,
      phone: ctx.user_extras?.phone ?? null,
      name: ctx.user?.first_name ?? ctx.user_extras?.email ?? null,
    };
  }

  /** Batch-fetch basic user info for multiple user IDs (deduped, parallel) */
  async batchGetUserBasicInfo(userIds: string[]): Promise<Map<string, UserBasicInfo>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const results = await Promise.allSettled(
      unique.map(id => this.getUserBasicInfo(id))
    );
    const map = new Map<string, UserBasicInfo>();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        map.set(unique[i], r.value);
      }
    });
    return map;
  }

  async listUsers(params?: {
    offset?: number;
    limit?: number;
    q?: string;
    created_after?: string;
    created_before?: string;
  }): Promise<UserListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());
    if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params?.q) searchParams.set('q', params.q);
    if (params?.created_after) searchParams.set('created_after', params.created_after);
    if (params?.created_before) searchParams.set('created_before', params.created_before);
    const query = searchParams.toString();
    return this.fetch<UserListResponse>(`/members/list${query ? `?${query}` : ''}`);
  }

  // Hotel Opportunities
  async listHotelOpportunitiesPendingPayment(params?: {
    limit?: number;
    offset?: number;
  }): Promise<HotelOpportunityListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.fetch<HotelOpportunityListResponse>(`/hotel-opportunities/pending-payment${query ? `?${query}` : ''}`);
  }

  async listHotelOpportunitiesPendingCancel(params?: {
    limit?: number;
    offset?: number;
  }): Promise<HotelOpportunityListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.fetch<HotelOpportunityListResponse>(`/hotel-opportunities/pending-cancel${query ? `?${query}` : ''}`);
  }

  async listHotelOpportunitiesActive(params?: {
    limit?: number;
    offset?: number;
  }): Promise<HotelOpportunityListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.fetch<HotelOpportunityListResponse>(`/hotel-opportunities/active${query ? `?${query}` : ''}`);
  }

  // Bookings
  async markBookingCancelled(
    bookingType: 'hotel' | 'flight',
    bookingId: string,
    outcome: 'cancelled' | 'unable_to_cancel',
    notes: string,
    confirmationCode?: string
  ): Promise<{ booking_id: string; booking_type: string; status: string; cancelled_at: string | null; operator: string; outcome: string }> {
    return this.fetch(`/bookings/${bookingType}/${bookingId}/mark-cancelled`, {
      method: 'POST',
      body: JSON.stringify({ outcome, notes, confirmation_code: confirmationCode }),
    });
  }

  async patchFlightBooking(
    bookingId: string,
    data: FlightBookingPatchRequest
  ): Promise<BookingPatchResponse> {
    return this.fetch<BookingPatchResponse>(`/bookings/flight/${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async patchHotelBooking(
    bookingId: string,
    data: HotelBookingPatchRequest
  ): Promise<BookingPatchResponse> {
    return this.fetch<BookingPatchResponse>(`/bookings/hotel/${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // Hotel booking detail (includes hotel_id from content service)
  async getHotelBookingDetail(bookingId: string): Promise<HotelBookingDetail> {
    return this.fetch<HotelBookingDetail>(`/bookings/hotel/${bookingId}`);
  }

  async batchGetHotelBookingDetails(bookingIds: string[]): Promise<Map<string, HotelBookingDetail>> {
    const unique = [...new Set(bookingIds.filter(Boolean))];
    const results = await Promise.allSettled(
      unique.map(id => this.getHotelBookingDetail(id))
    );
    const map = new Map<string, HotelBookingDetail>();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        map.set(unique[i], r.value);
      }
    });
    return map;
  }

  /**
   * Batch-fetch full MemberContext for multiple user IDs (deduped, parallel).
   * Returns both UserBasicInfo and BookingEnrichment maps extracted from the same data,
   * avoiding the broken GET /bookings/hotel/{id} endpoint.
   */
  async batchEnrichFromMembers(userIds: string[]): Promise<{
    userInfoMap: Map<string, UserBasicInfo>;
    bookingEnrichmentMap: Map<string, BookingEnrichment>;
  }> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const results = await Promise.allSettled(
      unique.map(id => this.getMember(id))
    );

    const userInfoMap = new Map<string, UserBasicInfo>();
    const bookingEnrichmentMap = new Map<string, BookingEnrichment>();

    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const ctx = r.value;
      const userId = unique[i];

      // Extract user info
      userInfoMap.set(userId, {
        id: userId,
        email: ctx.user_extras?.email ?? null,
        phone: ctx.user_extras?.phone ?? null,
        name: ctx.user?.first_name ?? ctx.user_extras?.email ?? null,
      });

      // Extract booking enrichments from trips
      for (const trip of ctx.trips) {
        for (const booking of trip.bookings) {
          if (booking.type === 'HOTEL' && booking.hotel) {
            const h = booking.hotel;
            bookingEnrichmentMap.set(booking.id, {
              id: booking.id,
              user_id: userId,
              hotel_name: h.hotel_name,
              hotel_city: h.hotel_city,
              room_type: h.room_type,
              guests: h.guests,
              total_price: h.total_price,
              confirmation_code: h.confirmation_code,
              booked_with: h.booked_with,
              check_in: h.check_in,
              check_out: h.check_out,
              status: booking.status,
            });
          }
        }
      }
    });

    return { userInfoMap, bookingEnrichmentMap };
  }

  /**
   * Like batchEnrichFromMembers but also extracts subscription_status and first_name.
   * Used by the outstanding repricings page for outreach.
   */
  async batchEnrichWithSubscription(userIds: string[]): Promise<{
    userInfoMap: Map<string, UserEnrichedInfo>;
    bookingEnrichmentMap: Map<string, BookingEnrichment>;
  }> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const results = await Promise.allSettled(
      unique.map(id => this.getMember(id))
    );

    const userInfoMap = new Map<string, UserEnrichedInfo>();
    const bookingEnrichmentMap = new Map<string, BookingEnrichment>();

    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const ctx = r.value;
      const userId = unique[i];

      userInfoMap.set(userId, {
        id: userId,
        email: ctx.user_extras?.email ?? null,
        phone: ctx.user_extras?.phone ?? null,
        name: ctx.user?.first_name ?? ctx.user_extras?.email ?? null,
        subscription_status: ctx.user?.subscription_status ?? null,
        first_name: ctx.user?.first_name ?? null,
      });

      for (const trip of ctx.trips) {
        for (const booking of trip.bookings) {
          if (booking.type === 'HOTEL' && booking.hotel) {
            const h = booking.hotel;
            bookingEnrichmentMap.set(booking.id, {
              id: booking.id,
              user_id: userId,
              hotel_name: h.hotel_name,
              hotel_city: h.hotel_city,
              room_type: h.room_type,
              guests: h.guests,
              total_price: h.total_price,
              confirmation_code: h.confirmation_code,
              booked_with: h.booked_with,
              check_in: h.check_in,
              check_out: h.check_out,
              status: booking.status,
            });
          }
        }
      }
    });

    return { userInfoMap, bookingEnrichmentMap };
  }

  async listHotelOpportunitiesCompleted(params?: {
    limit?: number;
    offset?: number;
  }): Promise<HotelOpportunityListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.fetch<HotelOpportunityListResponse>(`/hotel-opportunities/completed${query ? `?${query}` : ''}`);
  }

  // Watches
  async regenerateWatch(bookingId: string): Promise<WatchRegenerateResponse> {
    return this.fetch<WatchRegenerateResponse>(`/watches/regenerate/${bookingId}`, {
      method: 'POST',
    });
  }

  async retryWatchNow(watchId: string): Promise<WatchRetryResponse> {
    return this.fetch<WatchRetryResponse>(`/watches/${watchId}/retry-now`, {
      method: 'POST',
    });
  }

  async terminateWatch(watchId: string): Promise<WatchTerminateResponse> {
    return this.fetch<WatchTerminateResponse>(`/watches/${watchId}/terminate`, {
      method: 'POST',
    });
  }

  // Emails
  async getEmailForBooking(bookingType: 'flight' | 'hotel', bookingId: string): Promise<RawEmail> {
    return this.fetch<RawEmail>(`/emails/for-booking/${bookingType}/${bookingId}`);
  }

  async getEmailForTask(taskId: string): Promise<RawEmail> {
    return this.fetch<RawEmail>(`/emails/for-task/${taskId}`);
  }

  // Credit adjustments
  async adjustCredit(
    data: CreditAdjustmentRequest
  ): Promise<CreditAdjustmentResponse> {
    return this.fetch<CreditAdjustmentResponse>('/credits/axel/adjust', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Hotels
  async matchHotel(request: HotelMatchRequest): Promise<HotelMatchResponse> {
    return this.fetch<HotelMatchResponse>('/hotels/match', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Repricing pipeline health
  async getRepricingPipelineIssues(userId?: string): Promise<RepricingPipelineResponse> {
    const params = userId ? `?user_id=${userId}` : '';
    return this.fetch<RepricingPipelineResponse>(`/repricing-pipeline/issues/${params}`);
  }

  // Intercom
  async getIntercomContact(userId: string): Promise<IntercomContact | null> {
    try {
      return await this.fetch<IntercomContact>(`/intercom/contacts/${userId}`);
    } catch {
      return null; // Endpoint may not exist yet
    }
  }

  async getIntercomConversations(userId: string): Promise<IntercomConversation[]> {
    try {
      const result = await this.fetch<{ conversations: IntercomConversation[] }>(`/intercom/contacts/${userId}/conversations`);
      return result.conversations;
    } catch {
      return []; // Endpoint may not exist yet
    }
  }

  // Customer.io — looks up by email (CIO identifies users by email, not UUID)
  async getCustomerIoPerson(email: string): Promise<CustomerIoPerson | null> {
    try {
      return await this.fetch<CustomerIoPerson>(`/customerio/customers/by-email/${encodeURIComponent(email)}`);
    } catch {
      return null; // Endpoint may not exist yet
    }
  }

  async getCustomerIoActivities(email: string): Promise<CustomerIoActivity[]> {
    try {
      const result = await this.fetch<{ activities: CustomerIoActivity[] }>(`/customerio/customers/by-email/${encodeURIComponent(email)}/activities`);
      return result.activities;
    } catch {
      return []; // Endpoint may not exist yet
    }
  }

  async getBusinessDashboard(days?: number): Promise<BusinessDashboardResponse> {
    const params = days ? `?days=${days}` : '';
    return this.fetch<BusinessDashboardResponse>(`/metrics/dashboard${params}`);
  }

  // Hotel Bookings (Axel-booked only)
  async listHotelBookings(params?: {
    offset?: number;
    limit?: number;
    status?: string;
    check_in_after?: string;
    check_in_before?: string;
    sort_by?: string;
    sort_dir?: string;
    q?: string;
  }): Promise<HotelBookingListResponse> {
    const searchParams = new URLSearchParams();
    // Always filter to Axel-booked hotels only
    searchParams.set('source', 'axel');
    if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());
    if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params?.status) searchParams.set('status', params.status);
    if (params?.check_in_after) searchParams.set('check_in_after', params.check_in_after);
    if (params?.check_in_before) searchParams.set('check_in_before', params.check_in_before);
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_dir) searchParams.set('sort_dir', params.sort_dir);
    if (params?.q) searchParams.set('q', params.q);

    const query = searchParams.toString();
    return this.fetch<HotelBookingListResponse>(`/hotel-bookings${query ? `?${query}` : ''}`);
  }

  // Hotel Booking lookup by ID (any source — for edit form hydration)
  async getHotelBookingByIdFromList(bookingId: string): Promise<HotelBookingListItem | null> {
    const searchParams = new URLSearchParams();
    // No source filter — search across all sources (axel + imported)
    searchParams.set('q', bookingId);
    searchParams.set('limit', '1');
    const query = searchParams.toString();
    const result = await this.fetch<HotelBookingListResponse>(`/hotel-bookings?${query}`);
    return result?.bookings?.find((b) => b.id === bookingId) ?? null;
  }

  // Conv trips
  async listConvTrips(userId: string): Promise<ConvTripSummary[]> {
    return this.fetch<ConvTripSummary[]>(`/conv/trips/${userId}`);
  }

  // Wake cycle
  async wakeUser(
    userId: string,
    opts?: { feedback?: string; dryRun?: boolean; forceText?: boolean; idempotencyKey?: string },
  ): Promise<WakeResponse> {
    const body: Record<string, unknown> = {};
    if (opts?.feedback) body.feedback = opts.feedback;
    if (opts?.dryRun) body.dry_run = true;
    if (opts?.forceText) body.force_text = true;
    if (opts?.idempotencyKey) body.idempotency_key = opts.idempotencyKey;
    return this.fetch<WakeResponse>(`/conv/wake/${userId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async wakeTrip(
    userId: string,
    tripId: string,
    opts?: { feedback?: string; dryRun?: boolean; forceText?: boolean; idempotencyKey?: string },
  ): Promise<WakeResponse> {
    const body: Record<string, unknown> = {};
    if (opts?.feedback) body.feedback = opts.feedback;
    if (opts?.dryRun) body.dry_run = true;
    if (opts?.forceText) body.force_text = true;
    if (opts?.idempotencyKey) body.idempotency_key = opts.idempotencyKey;
    return this.fetch<WakeResponse>(`/conv/wake/${userId}/${tripId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}

export interface ConvTripSummary {
  id: string;
  name: string | null;
  headline: string | null;
  notify: boolean;
  archived: boolean;
  understanding?: string | null;
  needs_input?: boolean | null;
  booking_activity?: Array<{ event: string; summary?: string; type?: string; at?: string }> | null;
  conversation?: Array<{ from: string; text: string; at: string }> | null;
}

export interface WakeTripSummary {
  trip_id: string;
  name: string | null;
  headline: string | null;
  notify: boolean;
}

export interface WakeInterceptedTool {
  dry_run: true;
  would_call: string;
  args: Record<string, unknown>;
}

export interface WakeSendTextResult {
  drafted?: boolean;
  message_id?: string | null;
  status?: string | null;
  reason?: string | null;
  error?: string | null;
}

export interface WakePendingSmsDraft {
  message_id?: string | null;
  trip_id?: string | null;
  status?: string | null;
}

export interface WakeSendEmailResult {
  drafted?: boolean;
  message_id?: string | null;
  status?: string | null;
  reason?: string | null;
  error?: string | null;
}

export interface WakePendingEmailDraft {
  message_id?: string | null;
  trip_id?: string | null;
  status?: string | null;
  subject?: string | null;
}

export interface WakeResponse {
  mode?: string;
  response: string;
  trips?: WakeTripSummary[];
  tools_used?: string[];
  send_text_called?: boolean;
  send_text_result?: WakeSendTextResult | null;
  pending_sms_draft?: WakePendingSmsDraft | null;
  send_email_called?: boolean;
  send_email_result?: WakeSendEmailResult | null;
  pending_email_draft?: WakePendingEmailDraft | null;
  dry_run?: boolean;
  intercepted_tools?: WakeInterceptedTool[];
}

export interface HotelOpportunity {
  id: string;
  user_id: string;
  status: string;
  hotel_name: string | null;
  check_in: string | null;
  check_out: string | null;
  payment_status: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
  payment_due_at: string | null;
  old_booking_status: string | null;
  old_booking_provider: string | null;
  old_booking_confirmation_code: string | null;
  old_booking_id: string | null;
  cancellation_capability: string | null;
  cancellation_scheduled_at: string | null;
  created_at: string;
}

export interface HotelOpportunityListResponse {
  opportunities: HotelOpportunity[];
  total: number;
  limit: number;
  offset: number;
}

// ── Hotel Bookings (Axel-booked, source='axel') ──────────

export interface HotelBookingGuestItem {
  name: string;
  is_primary: boolean;
  citizenship: string | null;
}

export interface HotelBookingListItem {
  id: string;
  user_id: string;
  status: string;                           // pending | confirmed | in_progress | cancelled | completed
  verification_status: string | null;       // importing | unverified | functional | complete
  hotel_name: string | null;
  hotel_chain: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  confirmation_code: string | null;         // Axel confirmation code (AXL-XXXXXXXX)
  booking_provider: string | null;
  supplier: string | null;                  // "etg"
  supplier_confirmation_code: string | null; // Hotel-facing code guests use at check-in
  internal_supplier_reference: string | null; // ETG Order ID (lookup key on RateHawk)
  customer_price_amount: number | null;     // Minor units
  customer_price_currency: string | null;
  supplier_cost_amount: number | null;      // Minor units — what Axel paid to supplier
  supplier_cost_currency: string | null;
  margin_amount: number | null;             // Minor units
  original_price_amount: number | null;     // Minor units — pre-repricing price if applicable
  original_price_currency: string | null;
  guests: HotelBookingGuestItem[];
  room_type: string | null;
  is_award_booking: boolean;
  loyalty_program: string | null;
  loyalty_number: string | null;
  points_paid: number | null;
  axel_can_cancel: boolean;
  free_cancellation_until: string | null;
  cancellation_policy: Record<string, unknown> | null;
  replaced_by_booking_id: string | null;
  total_savings_amount: number | null;
  booked_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  conv_trip_id: string | null;
}

export interface HotelBookingListResponse {
  bookings: HotelBookingListItem[];
  total_count: number;
  limit: number;
  offset: number;
}

export interface UserBasicInfo {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
}

/** UserBasicInfo extended with subscription status for repricing outreach. */
export interface UserEnrichedInfo extends UserBasicInfo {
  subscription_status: string | null; // 'PAYING' | 'FREE'
  first_name: string | null;
}

/**
 * Enriched booking data extracted from MemberContext.trips[].bookings[].hotel.
 * Used by hotel repricing tracking page to display original price, guest names, etc.
 * This replaces the broken HotelBookingDetail enrichment (GET /bookings/hotel/{id} doesn't exist).
 */
export interface BookingEnrichment {
  id: string;
  user_id: string;
  hotel_name: string;
  hotel_city: string;
  room_type: string;
  guests: string[];           // string[] of guest names from HotelBookingView
  total_price: MoneyView;     // original booking price
  confirmation_code: string | null;
  booked_with: string | null;
  check_in: string;
  check_out: string;
  status: string;
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

export interface UserListItem {
  id: string;
  email: string | null;
  phone_number: string | null;
  name: string | null;
  status: string;
  membership_status: string | null;
  membership_plan: string | null;
  created_at: string;
  hotel_count?: number;
  flight_count?: number;
  email_count?: number;
  sms_opted_in?: boolean;
}

export interface UserListResponse {
  members: UserListItem[];
  total_count: number;
}


// Full member context - structure from operator_context endpoint

export interface UserView {
  primary_traveller_id: string;
  first_name: string | null;
  subscription_status: string; // PAYING, FREE, etc.
  is_member: boolean;
  credit_balance: number;
  credit_currency: string;
  total_savings: number;
  auto_reprice_flights: boolean;
  auto_reprice_hotels: boolean;
  action_threshold_usd: number;
  channels: string[]; // WHATSAPP, EMAIL, PUSH, SMS
  timezone: string | null;
  forwarding_email: string | null;
  referral_code: string | null;
}

export interface UserContextView {
  messages_sent_today: number;
  messages_sent_this_week: number;
  days_since_last_interaction: number;
  last_message_sent_at: string | null;
  last_message_received_at: string | null;
  narrative: string | null;
}

export interface UserExtras {
  id: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  stripe_customer_id: string | null;
  membership_expires_at: string | null;
}

export interface TravelerPassport {
  country: string;
  number: string;
  expiry: string | null;
}

export interface TravelerLoyaltyMembership {
  program_id: string;
  number: string;
}

export interface TravelerProfile {
  id: string;
  first_name: string | null;
  middle_name?: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  address_country?: string | null;
  citizenship?: string | null;
  known_traveler_number: string | null;
  redress_number: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
  passport_country: string | null;
  passports?: TravelerPassport[];
  loyalty_memberships?: TravelerLoyaltyMembership[];
  loyalty_programs: Record<string, string>;
  user_id?: string;
  is_account_holder?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FlightSegmentView {
  flight_number: string;
  airline: string;
  airline_name: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  cabin: string;
  seat: string | null;
}

export interface FlightLegView {
  direction: string; // OUTBOUND, RETURN
  segments: FlightSegmentView[];
}

// Legacy format (some endpoints may still use this)
export interface FlightLeg {
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  airline: string;
  flight_number: string;
  cabin_class: string | null;
}

export interface MoneyView {
  amount: number;
  currency: string;
}

export interface FlightBookingView {
  confirmation_code: string | null;
  booked_with: string | null;
  legs: FlightLegView[];
  passengers: string[];
  total_price: MoneyView;
  is_repriceable: boolean;
  reprice_ineligible_reason: string | null;
  // Legacy fields (for backwards compat)
  confirmation_number?: string | null;
  booking_provider?: string | null;
  customer_price?: number | null;
  currency?: string | null;
  reprice_eligibility?: string;
}

export interface HotelBookingView {
  confirmation_code: string | null;
  booked_with: string | null;
  hotel_name: string;
  hotel_city: string;
  hotel_id: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  room_type: string;
  guests: string[];
  total_price: MoneyView;
  is_repriceable: boolean;
  reprice_ineligible_reason: string | null;
  // Legacy fields (for backwards compat)
  confirmation_number?: string | null;
  booking_provider?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  customer_price?: number | null;
  currency?: string | null;
  refundability?: string | null;
  cancellation_deadline?: string | null;
  cancellation_capability?: string | null;
}

export interface BookingView {
  id: string;
  type: string; // FLIGHT or HOTEL
  status: string; // CONFIRMED, CANCELLED, etc.
  agent: string; // AXEL or MEMBER
  flight: FlightBookingView | null;
  hotel: HotelBookingView | null;
  created_at: string;
  watch_id: string | null; // NEW - link to watch if monitoring
  visible_thoughts?: ThoughtView[];
}

export interface ThoughtView {
  text: string;
  created_at: string;
}

export interface TripView {
  id: string;
  status: string; // FUTURE, IN_PROGRESS, PAST
  name: string | null;
  destination: string | null;
  purpose: string | null;
  start_date: string | null;
  end_date: string | null;
  bookings: BookingView[];
  visible_thoughts?: ThoughtView[];
}

export interface AirlineCreditView {
  id: string;
  airline: string;
  amount: number;
  currency: string;
  expiry_date: string | null;
  confirmation_number: string | null;
  status: string;
}

export interface WatchView {
  id: string;
  watch_type: string;
  status: string;
  booking_id: string | null;
  trip_id: string | null;
  quote_request_id: string | null;
  goal: string | null;
  source: string | null;
  priority: string | null;
  created_at: string;
  ended_at: string | null;
  threshold_amount: number | null;
  threshold_currency: string | null;
  // New observability fields
  latest_observed_price: MoneyView | null;
  latest_observed_at: string | null;
  last_executed_at: string | null;
  last_result: 'success' | 'empty' | 'timeout' | 'supplier_error' | null;
  next_due_at: string | null;
}

export interface FlightOpportunityView {
  id: string;
  status: string;
  booking_id: string | null;
  savings_amount: number | null;
  savings_currency: string | null;
  new_price: number | null;
  old_price: number | null;
  created_at: string;
}

export interface HotelOpportunityView {
  id: string;
  status: string;
  hotel_booking_id: string | null;
  // These fields exist on the type but are NOT sent by the backend HotelOpportunityResponse.
  // They will always be null from the member context API. Hotel details come from
  // the BookingView.hotel (HotelBookingView) found by matching hotel_booking_id in trips.
  hotel_name: string | null;
  check_in: string | null;
  check_out: string | null;
  savings_amount: number | null;
  savings_currency: string | null;
  new_price: number | null;
  old_price: number | null;
  // These fields ARE sent by the backend HotelOpportunityResponse
  original_price: MoneyView | null;
  target_price: MoneyView | null;
  payment_status: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
  cancellation_capability: string | null;
  cancellation_scheduled_at: string | null;
  failure_reason: string | null;
  original_booking_id: string | null;
  new_booking_id: string | null;
  created_at: string;
}

export interface CommunicationView {
  id: string;
  channel: string;
  direction: string; // INBOUND, OUTBOUND
  content: string;
  created_at: string;
}

export interface PendingPaymentView {
  id: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  due_at: string | null;
  booking_id: string | null;
}

export interface PendingTaskView {
  id: string;
  capability: string;
  status: string;
  priority: string;
  created_at: string;
}

export interface EscalationSummary {
  id: string;
  type: string;
  status: string;
  reason: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface PaymentRecord {
  id: string;
  type: string; // membership, booking
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  booking_id: string | null;
  stripe_payment_intent_id: string | null;
  failure_reason: string | null;
}

export interface ReferralStats {
  referral_code: string;
  total_referrals: number;
  successful_referrals: number;
  pending_referrals: number;
  total_earnings: number;
  earnings_currency: string;
}

export interface MemberContext {
  user: UserView | null;
  user_context: UserContextView | null;
  user_extras: UserExtras;
  travellers: TravelerProfile[];
  trips: TripView[];
  airline_credits: AirlineCreditView[];
  watches: WatchView[];
  flight_opportunities: FlightOpportunityView[];
  hotel_opportunities: HotelOpportunityView[];
  communications: CommunicationView[];
  pending_payments: PendingPaymentView[];
  pending_tasks: PendingTaskView[];
  escalations: EscalationSummary[];
  payment_records: PaymentRecord[];
  referral_stats: ReferralStats | null;
}

export interface RawEmail {
  id: string;
  subject: string | null;
  body: string | null;
  body_text?: string | null;
  body_html?: string | null;
  from_address: string | null;
  to_address: string | null;
  received_at: string | null;
  attachments: Array<{ filename: string; content_type: string }> | null;
}

// Booking edit types — matches backend Pydantic models

export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'REVIEW_PENDING';

export interface BookingTravelerPatch {
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  date_of_birth?: string;
  is_primary?: boolean;
  is_adult?: boolean;
  citizenship?: string;
  traveller_profile_id?: string;
}

export interface SeatAssignmentPatch {
  seat: string;
  segment_index?: number;
}

export interface BaggageAllowancePatch {
  carry_on_included?: boolean;
  checked_bags_included?: number;
  checked_weight_kg?: number;
}

export interface FlightTicketPatch {
  traveler: BookingTravelerPatch;
  ticket_number?: string;
  known_traveler_number?: string;
  redress_number?: string;
  loyalty_program?: string;
  loyalty_number?: string;
  seats?: SeatAssignmentPatch[];
  baggage?: BaggageAllowancePatch;
}

export interface FlightSegmentPatch {
  origin?: string;
  destination?: string;
  departure_date?: string;
  departure_time?: string;
  arrival_date?: string;
  arrival_time?: string;
  operating_carrier?: string;
  marketing_carrier?: string;
  flight_number?: string;
  marketing_flight_number?: string;
  cabin?: string;
  fare_family?: string;
  booking_class?: string;
  duration_minutes?: number;
  aircraft?: string;
  origin_terminal?: string;
  destination_terminal?: string;
  origin_city?: string;
  destination_city?: string;
}

export interface FlightLegPatch {
  direction?: 'outbound' | 'return';
  segments?: FlightSegmentPatch[];
}

export interface FlightBookingPatchRequest {
  confirmation_code?: string;
  booking_provider?: string;
  verification_status?: VerificationStatus;
  itinerary?: {
    legs?: FlightLegPatch[];
  };
  tickets?: FlightTicketPatch[];
  customer_price?: {
    amount: number;
    currency: string;
  };
}

export interface HotelPatchData {
  id?: string;
  name?: string;
  chain?: string;
  brand?: string;
  city?: string;
  country?: string;
  address?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  star_rating?: number;
  phone?: string;
  email?: string;
}

export interface RoomTypePatchData {
  id?: string;
  name?: string;
  bed_type?: string;
  bed_count?: number;
  max_occupancy?: number;
  max_adults?: number;
  max_children?: number;
  sqft?: number;
  sqm?: number;
  view?: string;
  smoking?: boolean;
  accessible?: boolean;
}

export interface HotelBookingPatchRequest {
  confirmation_code?: string;
  booking_provider?: string;
  verification_status?: VerificationStatus;
  stay?: {
    hotel?: HotelPatchData;
    room_type?: RoomTypePatchData;
    check_in?: string;
    check_out?: string;
    room_type_name?: string;
    rooms?: number;
    adults?: number;
    children?: number;
    children_ages?: number[];
    refundable?: boolean;
    meal_plan?: string;
  };
  guests?: BookingTravelerPatch[];
  customer_price?: {
    amount: number;
    currency: string;
  };
}

export interface BookingPatchResponse {
  booking_id: string;
  updated_fields: string[];
  trip_dates_recalculated: boolean;
}

export interface WatchRegenerateResponse {
  old_watch_id: string | null;
  new_watch_id: string;
  booking_id: string;
}

export interface WatchRetryResponse {
  success: boolean;
  watch_id: string;
  quote_request_id: string;
  next_due_at: string;
}

export interface WatchTerminateResponse {
  success: boolean;
  watch_id: string;
}

// Hotel matching types
export interface HotelMatchRequest {
  hotel_name: string;
  address?: string;
  coordinates?: { latitude: number; longitude: number };
  provider_ids?: Record<string, string>;
}

export interface HotelMatchResult {
  hotel_id: string;
  name: string;
  confidence_score: number;
  match_type: string;
  matched_fields: string[];
  distance_meters: number;
  provider_mappings: Record<string, string>;
}

export interface HotelMatchResponse {
  matches: HotelMatchResult[];
  total_matches: number;
  search_id: string;
}

// Member email update types
export interface UpdateMemberEmailRequest {
  email: string;
}

export interface UpdateMemberEmailResponse {
  message: string;
  email: string;
}

// Member name update types
export interface UpdateMemberNameRequest {
  name: string;
}

export interface UpdateMemberNameResponse {
  message: string;
  name: string;
}

// Member data deletion types
export interface DeleteMemberDataDetails {
  travel?: { trips?: number; flight_bookings?: number; [key: string]: number | undefined };
  payments?: { stripe_customers?: number; [key: string]: number | undefined };
  communications?: { messages?: number; [key: string]: number | undefined };
  travel_email?: { gmail_parsing_record?: number; [key: string]: number | undefined };
  users?: { users?: number; memberships?: number; [key: string]: number | undefined };
}

export interface DeleteMemberDataResponse {
  status: string;
  details: DeleteMemberDataDetails;
}

// Credit adjustment types
export interface CreditAdjustmentRequest {
  user_id: string;
  amount_cents: number; // Delta in cents: positive to add, negative to subtract
  reason: string; // Min 10 chars, max 500
  idempotency_key?: string;
}

export interface CreditAdjustmentResponse {
  id: string;
  user_id: string;
  amount_cents: number;
  transaction_type: string;
  description: string | null;
}

// Intercom types
export interface IntercomContact {
  intercom_id: string;
  email: string | null;
  name: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  browser: string | null;
  os: string | null;
  location: { city: string | null; country: string | null } | null;
  tags: string[];
  custom_attributes: Record<string, unknown>;
}

export interface IntercomConversation {
  id: string;
  state: string; // open, closed, snoozed
  title: string | null;
  created_at: string;
  updated_at: string;
  waiting_since: string | null;
  source: { type: string; author: { name: string; type: string } } | null;
  statistics: { last_contact_reply_at: string | null; last_admin_reply_at: string | null } | null;
}

// Repricing pipeline health types
export interface RepricingIssueTypeInfo {
  type: string;
  label: string;
  priority: number;
}

export interface RepricingPipelineIssue {
  issue_type: string;
  label: string;
  user_id: string;
  booking_id: string | null;
  booking_type: string | null;
  opportunity_id: string | null;
  watch_id: string | null;
  reason: string | null;
  status: string | null;
  parsed_result: Record<string, unknown> | null;
  approved_at: string | null;
  created_at: string | null;
}

export interface RepricingPipelineResponse {
  issue_types: RepricingIssueTypeInfo[];
  issues: RepricingPipelineIssue[];
  healthy_bookings: number;
}

// Customer.io types
export interface CustomerIoPerson {
  id: string;
  email: string | null;
  created_at: number | null; // unix timestamp
  attributes: Record<string, unknown>;
  unsubscribed: boolean;
}

export interface CustomerIoActivity {
  id: string;
  type: string; // sent_email, opened_email, clicked_email, bounced_email, etc.
  name: string | null; // campaign/message name
  timestamp: number; // unix timestamp
  delivery_id: string | null;
  campaign_id: number | null;
  subject: string | null;
  recipient: string | null;
}

// Business dashboard types
export interface BusinessPeriodPair {
  last_period: number;
  prev_period: number;
}

export interface MsrBreakdown {
  flight_reprice: BusinessPeriodPair;
  flight_upgrade: BusinessPeriodPair;
  hotel_reprice: BusinessPeriodPair;
  hotel_better: BusinessPeriodPair;
  total: BusinessPeriodPair;
}

export interface OnboardingFunnelSummary {
  signed_up: number;
  has_booking: number;
  has_watch: number;
  has_opportunity: number;
  has_opportunity_progressed: number;
}

export interface OnboardingFunnel {
  since: string;
  summary: OnboardingFunnelSummary;
  users: OnboardingFunnelUser[];
}

export interface BusinessDashboardResponse {
  gmv_usd_cents: BusinessPeriodPair;
  revenue_usd_cents: BusinessPeriodPair;
  msr: MsrBreakdown;
  active_users: BusinessPeriodPair;
  // Legacy fields — no longer returned by backend, kept for type compat with other pages
  users?: {
    total: MetricPoint;
    paid: MetricPoint;
    referred: MetricPoint;
    free: MetricPoint;
  } | null;
  bookings?: {
    total: MetricPoint;
    flights: MetricPoint;
    hotels: MetricPoint;
    monitored: MetricPoint;
  } | null;
  opportunities?: {
    total: MetricPoint;
    flights: MetricPoint;
    hotels: MetricPoint;
    completed: PeriodOnly;
  } | null;
  value?: {
    mrr_usd_cents: MetricPoint;
    money_rescued_usd_cents: PeriodOnly;
    hotel_revenue_usd_cents: PeriodOnly;
  } | null;
  pipeline_issues?: Array<{
    type: string;
    label: string;
    count: number;
    priority: number;
  }> | null;
  onboarding_funnel?: OnboardingFunnel | null;
}

// Legacy types — still imported by flight-repricing-funnel page.
// The backend no longer returns these via /metrics/dashboard.
export interface MetricPoint {
  current: number;
  last_7: number;
  prev_7: number;
}

export interface PeriodOnly {
  last_7: number;
  prev_7: number;
}

export interface OnboardingFunnelUser {
  user_id: string;
  email: string;
  signed_up: string;
  flight_bookings: number;
  hotel_bookings: number;
  flight_watches: number;
  hotel_watches: number;
  flight_opps: number;
  hotel_opps: number;
  flight_opp_statuses: Record<string, number>;
  hotel_opp_statuses: Record<string, number>;
  hours_to_first_booking: number | null;
  hours_to_first_opp: number | null;
}

// Subscription management types
export interface RefundMembershipRequest {
  reason: string;
  amount_cents?: number; // Optional for partial refund; omit for full refund
}

export interface RefundMembershipResponse {
  user_id: string;
  refund_id: string;
  amount_cents: number;
  subscription_id: string;
}

export interface SkipRenewalResponse {
  user_id: string;
  subscription_id: string;
  paused_until: string; // ISO datetime
  message: string;
}

export interface SuspendMemberResponse {
  message: string;
}

export interface UnsuspendMemberResponse {
  message: string;
}

export const api = new ApiClient(API_BASE);
