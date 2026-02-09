// Use local proxy to avoid CORS issues
const API_BASE = '/api/proxy';
const FETCH_TIMEOUT = 60000; // 60 seconds — Render cold starts can take 30-45s

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
  source: string;
  booking_channel: string | null;
  booking_provider: string | null;
  airline: string | null;
  airline_code: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  cabin_class: string | null;
  cash_paid: { amount: number; currency: string } | null;
  record_locator: string | null;
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
  hotel_name: string | null;
  hotel_chain: string | null;
  city: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  room_type: string | null;
  cash_paid: { amount: number; currency: string } | null;
  confirmation_number: string | null;
  booking_provider: string | null;
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
        throw new ApiError(0, 'Request timed out after 60 seconds — the backend may be waking up, please retry');
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

  async getMember(userId: string): Promise<MemberContext> {
    return this.fetch<MemberContext>(`/members/${userId}`);
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

  // Bookings
  async markBookingCancelled(
    bookingType: 'hotel' | 'flight',
    bookingId: string,
    notes: string,
    confirmationCode?: string
  ): Promise<{ booking_id: string; booking_type: string; status: string; cancelled_at: string; operator: string }> {
    return this.fetch(`/bookings/${bookingType}/${bookingId}/mark-cancelled`, {
      method: 'POST',
      body: JSON.stringify({ notes, confirmation_code: confirmationCode }),
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
  async getHotelBookingDetail(bookingId: string): Promise<{ hotel_id: string | null; [key: string]: unknown }> {
    return this.fetch<{ hotel_id: string | null }>(`/bookings/hotel/${bookingId}`);
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

  async getBusinessDashboard(): Promise<BusinessDashboardResponse> {
    return this.fetch<BusinessDashboardResponse>('/metrics/dashboard');
  }
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

export interface TravelerProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  known_traveler_number: string | null;
  redress_number: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
  passport_country: string | null;
  loyalty_programs: Record<string, string>;
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
  booking_id: string | null;
  hotel_name: string | null;
  check_in: string | null;
  check_out: string | null;
  savings_amount: number | null;
  savings_currency: string | null;
  new_price: number | null;
  old_price: number | null;
  payment_status: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
  cancellation_capability: string | null;
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

export interface FlightBookingPatchRequest {
  confirmation_code?: string;
  booking_provider?: string;
  verification_status?: VerificationStatus;
  itinerary?: {
    legs?: Array<{
      departure_airport?: string;
      arrival_airport?: string;
      departure_time?: string;
      arrival_time?: string;
      airline?: string;
      flight_number?: string;
      cabin_class?: string;
    }>;
  };
  tickets?: FlightTicketPatch[];
  customer_price?: {
    amount: number;
    currency: string;
  };
}

export interface HotelBookingPatchRequest {
  confirmation_code?: string;
  booking_provider?: string;
  verification_status?: VerificationStatus;
  stay?: {
    hotel?: {
      id?: string;
      name?: string;
    };
    check_in?: string;
    check_out?: string;
    room_type_name?: string;
    rooms?: number;
    adults?: number;
    children?: number;
    refundable?: boolean;
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
export interface MetricPoint {
  current: number;
  last_7: number;
  prev_7: number;
}

export interface PeriodOnly {
  last_7: number;
  prev_7: number;
}

export interface BusinessDashboardResponse {
  users: {
    total: MetricPoint;
    paid: MetricPoint;
    referred: MetricPoint;
    free: MetricPoint;
  } | null;
  bookings: {
    total: MetricPoint;
    flights: MetricPoint;
    hotels: MetricPoint;
    monitored: MetricPoint;
  } | null;
  opportunities: {
    total: MetricPoint;
    flights: MetricPoint;
    hotels: MetricPoint;
    completed: PeriodOnly;
  } | null;
  value: {
    mrr_usd_cents: MetricPoint;
    money_rescued_usd_cents: PeriodOnly;
    hotel_revenue_usd_cents: PeriodOnly;
  } | null;
  pipeline_issues: Array<{
    type: string;
    label: string;
    count: number;
    priority: number;
  }> | null;
}

export const api = new ApiClient(API_BASE);
