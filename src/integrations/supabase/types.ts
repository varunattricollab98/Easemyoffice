export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      booking_payments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          created_by: string | null
          id: string
          mode: string | null
          note: string | null
          paid_at: string
          payment_link: string | null
          reference: string | null
        }
        Insert: {
          amount?: number
          booking_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          mode?: string | null
          note?: string | null
          paid_at?: string
          payment_link?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          mode?: string | null
          note?: string | null
          paid_at?: string
          payment_link?: string | null
          reference?: string | null
        }
        Relationships: []
      }
      booking_updates: {
        Row: {
          action: string
          actor_id: string | null
          booking_id: string
          created_at: string
          detail: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          booking_id: string
          created_at?: string
          detail?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          booking_id?: string
          created_at?: string
          detail?: string | null
          id?: string
        }
        Relationships: []
      }
      crm_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      email_snippets: {
        Row: {
          body_html: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          body_html?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          lead_id: string | null
          read: boolean
          task_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          read?: boolean
          task_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          read?: boolean
          task_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          assigned_to: string | null
          attachments: Json
          booking_id: string | null
          client_name: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          is_html: boolean
          lead_id: string | null
          message: string
          occurrences_sent: number
          repeat_interval_days: number
          repeat_until: string | null
          send_at: string
          sent_at: string | null
          status: string
          subject: string
          to_email: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          attachments?: Json
          booking_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          is_html?: boolean
          lead_id?: string | null
          message: string
          occurrences_sent?: number
          repeat_interval_days?: number
          repeat_until?: string | null
          send_at: string
          sent_at?: string | null
          status?: string
          subject: string
          to_email: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          attachments?: Json
          booking_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          is_html?: boolean
          lead_id?: string | null
          message?: string
          occurrences_sent?: number
          repeat_interval_days?: number
          repeat_until?: string | null
          send_at?: string
          sent_at?: string | null
          status?: string
          subject?: string
          to_email?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_targets: {
        Row: {
          bookings: number
          profit: number
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          bookings?: number
          profit?: number
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          bookings?: number
          profit?: number
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          addon_amount: number
          addon_gst: number
          addon_payable: number
          addon_services: string | null
          alt_contact_no: string | null
          alt_contact_no_2: string | null
          amount_after_tds: number
          amount_received: number
          area: string | null
          assigned_to: string | null
          balance_amount: number
          balance_due_date: string | null
          balance_paid_at: string | null
          booking_code: string
          booking_date: string
          booking_source: string
          business_name: string | null
          city: string | null
          client_name: string
          contact_no: string
          created_at: string
          created_by: string | null
          discount_amount: number
          email_id: string | null
          external_booking_id: string | null
          id: string
          invoice_number: string | null
          last_reminder_sent_at: string | null
          quoted_amount: number
          payment_id_utr: string | null
          payment_mode_ref: string | null
          plan_name: string
          profit: number
          remarks: string | null
          sales_agent_id: string | null
          sales_agent_name: string
          sales_month: string | null
          sp_name: string | null
          sp_payable: number
          sp_payment_status: string
          sp_status: string | null
          state: string | null
          tds_amount: number
          tds_pct: number
          total_amount: number
          updated_at: string
          vo_amount: number
          vo_gst: number
          vo_plan: string | null
          vo_status: string
        }
        Insert: {
          addon_amount?: number
          addon_gst?: number
          addon_payable?: number
          addon_services?: string | null
          alt_contact_no?: string | null
          alt_contact_no_2?: string | null
          amount_after_tds?: number
          amount_received?: number
          area?: string | null
          assigned_to?: string | null
          balance_amount?: number
          balance_due_date?: string | null
          balance_paid_at?: string | null
          booking_code?: string
          booking_date?: string
          booking_source?: string
          business_name?: string | null
          city?: string | null
          client_name: string
          contact_no: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          email_id?: string | null
          external_booking_id?: string | null
          id?: string
          invoice_number?: string | null
          last_reminder_sent_at?: string | null
          quoted_amount?: number
          payment_id_utr?: string | null
          payment_mode_ref?: string | null
          plan_name: string
          profit?: number
          remarks?: string | null
          sales_agent_id?: string | null
          sales_agent_name: string
          sales_month?: string | null
          sp_name?: string | null
          sp_payable?: number
          sp_payment_status?: string
          sp_status?: string | null
          state?: string | null
          tds_amount?: number
          tds_pct?: number
          total_amount?: number
          updated_at?: string
          vo_amount?: number
          vo_gst?: number
          vo_plan?: string | null
          vo_status?: string
        }
        Update: {
          addon_amount?: number
          addon_gst?: number
          addon_payable?: number
          addon_services?: string | null
          alt_contact_no?: string | null
          alt_contact_no_2?: string | null
          amount_after_tds?: number
          amount_received?: number
          area?: string | null
          assigned_to?: string | null
          balance_amount?: number
          balance_due_date?: string | null
          balance_paid_at?: string | null
          booking_code?: string
          booking_date?: string
          booking_source?: string
          business_name?: string | null
          city?: string | null
          client_name?: string
          contact_no?: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          email_id?: string | null
          external_booking_id?: string | null
          id?: string
          invoice_number?: string | null
          last_reminder_sent_at?: string | null
          quoted_amount?: number
          payment_id_utr?: string | null
          payment_mode_ref?: string | null
          plan_name?: string
          profit?: number
          remarks?: string | null
          sales_agent_id?: string | null
          sales_agent_name?: string
          sales_month?: string | null
          sp_name?: string | null
          sp_payable?: number
          sp_payment_status?: string
          sp_status?: string | null
          state?: string | null
          tds_amount?: number
          tds_pct?: number
          total_amount?: number
          updated_at?: string
          vo_amount?: number
          vo_gst?: number
          vo_plan?: string | null
          vo_status?: string
        }
        Relationships: []
      }
      follow_ups: {
        Row: {
          action: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          lead_id: string
          note: string | null
          owner_id: string | null
          status: Database["public"]["Enums"]["followup_status"]
          updated_at: string
        }
        Insert: {
          action: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at: string
          id?: string
          lead_id: string
          note?: string | null
          owner_id?: string | null
          status?: Database["public"]["Enums"]["followup_status"]
          updated_at?: string
        }
        Update: {
          action?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          lead_id?: string
          note?: string | null
          owner_id?: string | null
          status?: Database["public"]["Enums"]["followup_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_events: {
        Row: {
          created_at: string
          id: string
          kpi_id: string
          label: string | null
          path: string | null
          search: Json
          team: string | null
          user_id: string
          value: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          kpi_id: string
          label?: string | null
          path?: string | null
          search?: Json
          team?: string | null
          user_id: string
          value?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          kpi_id?: string
          label?: string | null
          path?: string | null
          search?: Json
          team?: string | null
          user_id?: string
          value?: number | null
        }
        Relationships: []
      }
      lead_activities: {
        Row: {
          actor_id: string | null
          body: string | null
          created_at: string
          id: string
          lead_id: string
          payload: Json
          title: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          lead_id: string
          payload?: Json
          title: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          payload?: Json
          title?: string
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          alt_mobile: string | null
          assigned_agent: string | null
          assigned_to: string | null
          budget: number | null
          call_outcome: string | null
          converted_date: string | null
          external_lead_id: string | null
          follow_up_3: string | null
          last_follow_up: string | null
          last_synced: string | null
          latest_remark: string | null
          lead_outcome: string | null
          lead_status: string | null
          lost_reason: string | null
          next_follow_up: string | null
          received_date: string | null
          remark_updated_on: string | null
          revenue: number | null
          city: string | null
          client_name: string
          company_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          intent_flags: Json
          interest: Database["public"]["Enums"]["lead_interest"]
          last_activity_at: string
          lead_code: string
          mobile: string
          next_follow_up_at: string | null
          notes: string | null
          score: number
          service_required: Database["public"]["Enums"]["service_type"]
          source: Database["public"]["Enums"]["lead_source"]
          stage: Database["public"]["Enums"]["lead_stage"]
          state: string | null
          updated_at: string
        }
        Insert: {
          alt_mobile?: string | null
          assigned_agent?: string | null
          assigned_to?: string | null
          budget?: number | null
          call_outcome?: string | null
          converted_date?: string | null
          external_lead_id?: string | null
          follow_up_3?: string | null
          last_follow_up?: string | null
          last_synced?: string | null
          latest_remark?: string | null
          lead_outcome?: string | null
          lead_status?: string | null
          lost_reason?: string | null
          next_follow_up?: string | null
          received_date?: string | null
          remark_updated_on?: string | null
          revenue?: number | null
          city?: string | null
          client_name: string
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          intent_flags?: Json
          interest?: Database["public"]["Enums"]["lead_interest"]
          last_activity_at?: string
          lead_code?: string
          mobile: string
          next_follow_up_at?: string | null
          notes?: string | null
          score?: number
          service_required?: Database["public"]["Enums"]["service_type"]
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["lead_stage"]
          state?: string | null
          updated_at?: string
        }
        Update: {
          alt_mobile?: string | null
          assigned_agent?: string | null
          assigned_to?: string | null
          budget?: number | null
          call_outcome?: string | null
          converted_date?: string | null
          external_lead_id?: string | null
          follow_up_3?: string | null
          last_follow_up?: string | null
          last_synced?: string | null
          latest_remark?: string | null
          lead_outcome?: string | null
          lead_status?: string | null
          lost_reason?: string | null
          next_follow_up?: string | null
          received_date?: string | null
          remark_updated_on?: string | null
          revenue?: number | null
          city?: string | null
          client_name?: string
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          intent_flags?: Json
          interest?: Database["public"]["Enums"]["lead_interest"]
          last_activity_at?: string
          lead_code?: string
          mobile?: string
          next_follow_up_at?: string | null
          notes?: string | null
          score?: number
          service_required?: Database["public"]["Enums"]["service_type"]
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["lead_stage"]
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          created_at: string
          daily_digest: boolean
          email_address: string | null
          email_enabled: boolean
          in_app_enabled: boolean
          remind_minutes_before: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_digest?: boolean
          email_address?: string | null
          email_enabled?: boolean
          in_app_enabled?: boolean
          remind_minutes_before?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_digest?: boolean
          email_address?: string | null
          email_enabled?: boolean
          in_app_enabled?: boolean
          remind_minutes_before?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      report_subscriptions: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          enabled: boolean
          frequency: string
          id: string
          last_sent_at: string | null
          reports: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          enabled?: boolean
          frequency?: string
          id?: string
          last_sent_at?: string | null
          reports?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          enabled?: boolean
          frequency?: string
          id?: string
          last_sent_at?: string | null
          reports?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          lead_id: string | null
          last_reminded_at: string | null
          owner_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          last_reminded_at?: string | null
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          last_reminded_at?: string | null
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_theme_prefs: {
        Row: {
          prefs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          prefs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          prefs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clear_demo_data: { Args: never; Returns: undefined }
      find_duplicate_lead: {
        Args: { p_mobile: string; p_email: string }
        Returns: {
          id: string
          lead_code: string
          client_name: string
          owner_name: string
          mine: boolean
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      seed_demo_leads: { Args: never; Returns: number }
    }
    Enums: {
      activity_type:
        | "note"
        | "call"
        | "email"
        | "whatsapp"
        | "stage_change"
        | "assignment"
        | "followup"
        | "created"
      app_role:
        | "admin"
        | "sales"
        | "documentation"
        | "accounts"
        | "renewals"
        | "bd"
      followup_status: "pending" | "done" | "missed"
      lead_interest: "hot" | "warm" | "cold" | "dead"
      lead_source:
        | "website"
        | "email"
        | "whatsapp"
        | "indiamart"
        | "google_ads"
        | "meta_ads"
        | "referral"
        | "direct_call"
        | "other"
      lead_stage:
        | "new_lead"
        | "contacted"
        | "interested"
        | "quotation_shared"
        | "negotiation"
        | "followups"
        | "payment_pending"
        | "payment_received"
        | "documents_pending"
        | "draft_shared"
        | "agreement_signed"
        | "completed"
        | "renewal_due"
        | "not_interested"
        | "lost"
      service_type:
        | "virtual_office"
        | "gst_registration"
        | "apob"
        | "business_registration"
        | "iec"
        | "trademark"
        | "other"
      task_priority: "high" | "medium" | "low"
      task_status: "todo" | "in_progress" | "done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: [
        "note",
        "call",
        "email",
        "whatsapp",
        "stage_change",
        "assignment",
        "followup",
        "created",
      ],
      app_role: [
        "admin",
        "sales",
        "documentation",
        "accounts",
        "renewals",
        "bd",
      ],
      followup_status: ["pending", "done", "missed"],
      lead_interest: ["hot", "warm", "cold", "dead"],
      lead_source: [
        "website",
        "email",
        "whatsapp",
        "indiamart",
        "google_ads",
        "meta_ads",
        "referral",
        "direct_call",
        "other",
      ],
      lead_stage: [
        "new_lead",
        "contacted",
        "interested",
        "documents_pending",
        "quotation_shared",
        "negotiation",
        "payment_pending",
        "payment_received",
        "draft_shared",
        "agreement_signed",
        "completed",
        "renewal_due",
        "lost",
      ],
      service_type: [
        "virtual_office",
        "gst_registration",
        "apob",
        "business_registration",
        "iec",
        "trademark",
        "other",
      ],
      task_priority: ["high", "medium", "low"],
      task_status: ["todo", "in_progress", "done"],
    },
  },
} as const
