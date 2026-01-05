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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      adverts: {
        Row: {
          advertiser_email: string | null
          advertiser_id: string | null
          advertiser_name: string | null
          channel: string
          clicks_count: number | null
          created_at: string | null
          description: string | null
          duration_hours: number | null
          end_at: string | null
          id: string
          media_url: string | null
          start_at: string | null
          status: string | null
          target_audience: Json | null
          title: string
          views_count: number | null
        }
        Insert: {
          advertiser_email?: string | null
          advertiser_id?: string | null
          advertiser_name?: string | null
          channel: string
          clicks_count?: number | null
          created_at?: string | null
          description?: string | null
          duration_hours?: number | null
          end_at?: string | null
          id?: string
          media_url?: string | null
          start_at?: string | null
          status?: string | null
          target_audience?: Json | null
          title: string
          views_count?: number | null
        }
        Update: {
          advertiser_email?: string | null
          advertiser_id?: string | null
          advertiser_name?: string | null
          channel?: string
          clicks_count?: number | null
          created_at?: string | null
          description?: string | null
          duration_hours?: number | null
          end_at?: string | null
          id?: string
          media_url?: string | null
          start_at?: string | null
          status?: string | null
          target_audience?: Json | null
          title?: string
          views_count?: number | null
        }
        Relationships: []
      }
      ai_search_logs: {
        Row: {
          created_at: string | null
          id: string
          query: string
          result: string | null
          search_type: string
          success: boolean | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          query: string
          result?: string | null
          search_type: string
          success?: boolean | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          query?: string
          result?: string | null
          search_type?: string
          success?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      complaints: {
        Row: {
          assigned_team: string | null
          created_at: string | null
          description: string
          id: string
          issue_type: string
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          assigned_team?: string | null
          created_at?: string | null
          description: string
          id?: string
          issue_type: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          assigned_team?: string | null
          created_at?: string | null
          description?: string
          id?: string
          issue_type?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      education_modules: {
        Row: {
          category: string | null
          content: string | null
          created_at: string | null
          description: string | null
          id: string
          is_published: boolean | null
          order_index: number | null
          subcategory: string | null
          tier_required: Database["public"]["Enums"]["user_tier"] | null
          title: string
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          category?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_published?: boolean | null
          order_index?: number | null
          subcategory?: string | null
          tier_required?: Database["public"]["Enums"]["user_tier"] | null
          title: string
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          category?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_published?: boolean | null
          order_index?: number | null
          subcategory?: string | null
          tier_required?: Database["public"]["Enums"]["user_tier"] | null
          title?: string
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      firm_staff: {
        Row: {
          created_at: string | null
          firm_id: string
          id: string
          role: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          firm_id: string
          id?: string
          role?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          firm_id?: string
          id?: string
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_staff_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          contact_address: string | null
          contact_email: string | null
          contact_person_name: string | null
          contact_person_title: string | null
          contact_phone: string | null
          country: string | null
          created_at: string | null
          description: string | null
          firm_name: string
          id: string
          is_verified: boolean | null
          license_document_url: string | null
          license_number: string | null
          logo_url: string | null
          owner_id: string
          sector: string | null
          updated_at: string | null
          verified_at: string | null
        }
        Insert: {
          contact_address?: string | null
          contact_email?: string | null
          contact_person_name?: string | null
          contact_person_title?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          firm_name: string
          id?: string
          is_verified?: boolean | null
          license_document_url?: string | null
          license_number?: string | null
          logo_url?: string | null
          owner_id: string
          sector?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Update: {
          contact_address?: string | null
          contact_email?: string | null
          contact_person_name?: string | null
          contact_person_title?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          firm_name?: string
          id?: string
          is_verified?: boolean | null
          license_document_url?: string | null
          license_number?: string | null
          logo_url?: string | null
          owner_id?: string
          sector?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      groups: {
        Row: {
          contact_person_email: string | null
          contact_person_name: string | null
          contact_person_phone: string | null
          country: string | null
          created_at: string | null
          gfe_terms_agreed_at: string | null
          group_address: string | null
          group_email: string | null
          group_name: string
          group_phone: string | null
          group_size: string | null
          group_type: string
          id: string
          is_gfe: boolean | null
          logo_url: string | null
          owner_id: string
          region: string | null
          updated_at: string | null
          user_tier: Database["public"]["Enums"]["user_tier"] | null
        }
        Insert: {
          contact_person_email?: string | null
          contact_person_name?: string | null
          contact_person_phone?: string | null
          country?: string | null
          created_at?: string | null
          gfe_terms_agreed_at?: string | null
          group_address?: string | null
          group_email?: string | null
          group_name: string
          group_phone?: string | null
          group_size?: string | null
          group_type: string
          id?: string
          is_gfe?: boolean | null
          logo_url?: string | null
          owner_id: string
          region?: string | null
          updated_at?: string | null
          user_tier?: Database["public"]["Enums"]["user_tier"] | null
        }
        Update: {
          contact_person_email?: string | null
          contact_person_name?: string | null
          contact_person_phone?: string | null
          country?: string | null
          created_at?: string | null
          gfe_terms_agreed_at?: string | null
          group_address?: string | null
          group_email?: string | null
          group_name?: string
          group_phone?: string | null
          group_size?: string | null
          group_type?: string
          id?: string
          is_gfe?: boolean | null
          logo_url?: string | null
          owner_id?: string
          region?: string | null
          updated_at?: string | null
          user_tier?: Database["public"]["Enums"]["user_tier"] | null
        }
        Relationships: []
      }
      investment_opportunities: {
        Row: {
          admin_notes: string | null
          category: string
          comments_count: number | null
          created_at: string | null
          description: string | null
          documents_url: string[] | null
          duration: string | null
          expected_roi: number | null
          firm_id: string
          id: string
          likes_count: number | null
          media_url: string | null
          minimum_amount: number | null
          payment_frequency: string | null
          risk_level: string | null
          sdg_tags: string[] | null
          shares_count: number | null
          status: Database["public"]["Enums"]["investment_status"] | null
          title: string
          updated_at: string | null
          views_count: number | null
        }
        Insert: {
          admin_notes?: string | null
          category: string
          comments_count?: number | null
          created_at?: string | null
          description?: string | null
          documents_url?: string[] | null
          duration?: string | null
          expected_roi?: number | null
          firm_id: string
          id?: string
          likes_count?: number | null
          media_url?: string | null
          minimum_amount?: number | null
          payment_frequency?: string | null
          risk_level?: string | null
          sdg_tags?: string[] | null
          shares_count?: number | null
          status?: Database["public"]["Enums"]["investment_status"] | null
          title: string
          updated_at?: string | null
          views_count?: number | null
        }
        Update: {
          admin_notes?: string | null
          category?: string
          comments_count?: number | null
          created_at?: string | null
          description?: string | null
          documents_url?: string[] | null
          duration?: string | null
          expected_roi?: number | null
          firm_id?: string
          id?: string
          likes_count?: number | null
          media_url?: string | null
          minimum_amount?: number | null
          payment_frequency?: string | null
          risk_level?: string | null
          sdg_tags?: string[] | null
          shares_count?: number | null
          status?: Database["public"]["Enums"]["investment_status"] | null
          title?: string
          updated_at?: string | null
          views_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "investment_opportunities_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_read: boolean | null
          parent_id: string | null
          recipient_id: string | null
          recipient_team: string | null
          sender_id: string
          subject: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          parent_id?: string | null
          recipient_id?: string | null
          recipient_team?: string | null
          sender_id: string
          subject?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          parent_id?: string | null
          recipient_id?: string | null
          recipient_team?: string | null
          sender_id?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          is_read: boolean | null
          message: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string | null
          id: string
          is_hidden: boolean | null
          post_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string | null
          id?: string
          is_hidden?: boolean | null
          post_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string | null
          id?: string
          is_hidden?: boolean | null
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_shares: {
        Row: {
          created_at: string | null
          id: string
          platform: string | null
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          platform?: string | null
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          platform?: string | null
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_shares_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          attachment_type: string | null
          attachment_url: string | null
          author_id: string
          category: Database["public"]["Enums"]["post_category"]
          comments_count: number | null
          content: string
          created_at: string | null
          id: string
          is_approved: boolean | null
          is_hidden: boolean | null
          is_pinned: boolean | null
          likes_count: number | null
          shares_count: number | null
          updated_at: string | null
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          author_id: string
          category: Database["public"]["Enums"]["post_category"]
          comments_count?: number | null
          content: string
          created_at?: string | null
          id?: string
          is_approved?: boolean | null
          is_hidden?: boolean | null
          is_pinned?: boolean | null
          likes_count?: number | null
          shares_count?: number | null
          updated_at?: string | null
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          author_id?: string
          category?: Database["public"]["Enums"]["post_category"]
          comments_count?: number | null
          content?: string
          created_at?: string | null
          id?: string
          is_approved?: boolean | null
          is_hidden?: boolean | null
          is_pinned?: boolean | null
          likes_count?: number | null
          shares_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          assigned_role: string | null
          avatar_url: string | null
          country: string | null
          created_at: string | null
          date_of_birth: string | null
          disability_status: string | null
          email: string | null
          full_name: string | null
          gender: string | null
          gfe_terms_agreed_at: string | null
          id: string
          institution: string | null
          is_gfe: boolean | null
          languages_spoken: string[] | null
          occupation: string | null
          onboarding_completed: boolean | null
          phone: string | null
          preferred_language: string | null
          profile_completed: boolean | null
          referral_code: string | null
          referred_by: string | null
          region: string | null
          residential_address: string | null
          sector: string | null
          signup_reasons: string[] | null
          updated_at: string | null
          user_tier: Database["public"]["Enums"]["user_tier"] | null
          user_type: Database["public"]["Enums"]["user_type"] | null
        }
        Insert: {
          assigned_role?: string | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          disability_status?: string | null
          email?: string | null
          full_name?: string | null
          gender?: string | null
          gfe_terms_agreed_at?: string | null
          id: string
          institution?: string | null
          is_gfe?: boolean | null
          languages_spoken?: string[] | null
          occupation?: string | null
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          profile_completed?: boolean | null
          referral_code?: string | null
          referred_by?: string | null
          region?: string | null
          residential_address?: string | null
          sector?: string | null
          signup_reasons?: string[] | null
          updated_at?: string | null
          user_tier?: Database["public"]["Enums"]["user_tier"] | null
          user_type?: Database["public"]["Enums"]["user_type"] | null
        }
        Update: {
          assigned_role?: string | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          disability_status?: string | null
          email?: string | null
          full_name?: string | null
          gender?: string | null
          gfe_terms_agreed_at?: string | null
          id?: string
          institution?: string | null
          is_gfe?: boolean | null
          languages_spoken?: string[] | null
          occupation?: string | null
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          profile_completed?: boolean | null
          referral_code?: string | null
          referred_by?: string | null
          region?: string | null
          residential_address?: string | null
          sector?: string | null
          signup_reasons?: string[] | null
          updated_at?: string | null
          user_tier?: Database["public"]["Enums"]["user_tier"] | null
          user_type?: Database["public"]["Enums"]["user_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_stats: {
        Row: {
          created_at: string | null
          id: string
          total_clicks: number | null
          total_earnings: number | null
          total_investing: number | null
          total_signups: number | null
          total_subscribed: number | null
          total_verified: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          total_clicks?: number | null
          total_earnings?: number | null
          total_investing?: number | null
          total_signups?: number | null
          total_subscribed?: number | null
          total_verified?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          total_clicks?: number | null
          total_earnings?: number | null
          total_investing?: number | null
          total_signups?: number | null
          total_subscribed?: number | null
          total_verified?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          id: string
          key: string
          updated_at: string | null
          updated_by: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      user_investments: {
        Row: {
          amount: number
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string | null
          gains: number | null
          id: string
          opportunity_id: string
          started_at: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          amount: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          gains?: number | null
          id?: string
          opportunity_id: string
          started_at?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          gains?: number | null
          id?: string
          opportunity_id?: string
          started_at?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_investments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "investment_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_progress: {
        Row: {
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          id: string
          module_id: string
          quiz_score: number | null
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          module_id: string
          quiz_score?: number | null
          user_id: string
        }
        Update: {
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          module_id?: string
          quiz_score?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_progress_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "education_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          actor_id: string | null
          amount: number
          created_at: string | null
          id: string
          narration: string | null
          source: string | null
          status: string | null
          transaction_type: string
          wallet_id: string
        }
        Insert: {
          actor_id?: string | null
          amount: number
          created_at?: string | null
          id?: string
          narration?: string | null
          source?: string | null
          status?: string | null
          transaction_type: string
          wallet_id: string
        }
        Update: {
          actor_id?: string | null
          amount?: number
          created_at?: string | null
          id?: string
          narration?: string | null
          source?: string | null
          status?: string | null
          transaction_type?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          bank_account_name: string | null
          bank_account_number: string | null
          bank_details_locked: boolean | null
          bank_name: string | null
          created_at: string | null
          gem_points: number | null
          gfe_wallet_balance: number | null
          id: string
          updated_at: string | null
          user_id: string
          user_wallet_balance: number | null
        }
        Insert: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_details_locked?: boolean | null
          bank_name?: string | null
          created_at?: string | null
          gem_points?: number | null
          gfe_wallet_balance?: number | null
          id?: string
          updated_at?: string | null
          user_id: string
          user_wallet_balance?: number | null
        }
        Update: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_details_locked?: boolean | null
          bank_name?: string | null
          created_at?: string | null
          gem_points?: number | null
          gfe_wallet_balance?: number | null
          id?: string
          updated_at?: string | null
          user_id?: string
          user_wallet_balance?: number | null
        }
        Relationships: []
      }
      withdrawal_requests: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          notes: string | null
          processed_at: string | null
          processed_by: string | null
          status: string | null
          user_id: string
          wallet_type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          notes?: string | null
          processed_at?: string | null
          processed_by?: string | null
          status?: string | null
          user_id: string
          wallet_type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          processed_at?: string | null
          processed_by?: string | null
          status?: string | null
          user_id?: string
          wallet_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_referral_code: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "moderator"
        | "user"
        | "gfe"
        | "firm_admin"
        | "firm_staff"
      investment_status:
        | "pending"
        | "approved"
        | "rejected"
        | "paused"
        | "flagged"
        | "archived"
      post_category:
        | "education"
        | "finance"
        | "climate"
        | "investment"
        | "advert"
        | "scam_alert"
        | "announcement"
      user_tier: "free" | "premium" | "exclusive"
      user_type: "individual" | "group" | "firm"
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
      app_role: [
        "admin",
        "moderator",
        "user",
        "gfe",
        "firm_admin",
        "firm_staff",
      ],
      investment_status: [
        "pending",
        "approved",
        "rejected",
        "paused",
        "flagged",
        "archived",
      ],
      post_category: [
        "education",
        "finance",
        "climate",
        "investment",
        "advert",
        "scam_alert",
        "announcement",
      ],
      user_tier: ["free", "premium", "exclusive"],
      user_type: ["individual", "group", "firm"],
    },
  },
} as const
