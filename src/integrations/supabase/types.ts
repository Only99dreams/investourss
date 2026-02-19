export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          phone: string | null
          avatar_url: string | null
          country: string | null
          region: string | null
          gender: string | null
          date_of_birth: string | null
          disability_status: string | null
          occupation: string | null
          sector: string | null
          institution: string | null
          languages_spoken: string[] | null
          preferred_language: string | null
          residential_address: string | null
          referral_code: string | null
          referred_by: string | null
          user_type: string | null
          user_tier: string | null
          is_gfe: boolean | null
          gfe_terms_agreed_at: string | null
          onboarding_completed: boolean | null
          profile_completed: boolean | null
          signup_reasons: string[] | null
          assigned_role: string | null
          is_bde: boolean | null
          bde_status: string | null
          bde_assigned_at: string | null
          bde_assigned_by: string | null
          subscription_type: string | null
          email_opt_in: boolean | null
          engagement_credit_earned: boolean | null
          ai_tutor_used: number | null
          videos_watched: number | null
          posts_created: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          phone?: string | null
          avatar_url?: string | null
          country?: string | null
          region?: string | null
          gender?: string | null
          date_of_birth?: string | null
          disability_status?: string | null
          occupation?: string | null
          sector?: string | null
          institution?: string | null
          languages_spoken?: string[] | null
          preferred_language?: string | null
          residential_address?: string | null
          referral_code?: string | null
          referred_by?: string | null
          user_type?: string | null
          user_tier?: string | null
          is_gfe?: boolean | null
          gfe_terms_agreed_at?: string | null
          onboarding_completed?: boolean | null
          profile_completed?: boolean | null
          signup_reasons?: string[] | null
          assigned_role?: string | null
          is_bde?: boolean | null
          bde_status?: string | null
          bde_assigned_at?: string | null
          bde_assigned_by?: string | null
          subscription_type?: string | null
          email_opt_in?: boolean | null
          engagement_credit_earned?: boolean | null
          ai_tutor_used?: number | null
          videos_watched?: number | null
          posts_created?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          email?: string | null
          full_name?: string | null
          phone?: string | null
          avatar_url?: string | null
          country?: string | null
          region?: string | null
          gender?: string | null
          date_of_birth?: string | null
          disability_status?: string | null
          occupation?: string | null
          sector?: string | null
          institution?: string | null
          languages_spoken?: string[] | null
          preferred_language?: string | null
          residential_address?: string | null
          referral_code?: string | null
          referred_by?: string | null
          user_type?: string | null
          user_tier?: string | null
          is_gfe?: boolean | null
          gfe_terms_agreed_at?: string | null
          onboarding_completed?: boolean | null
          profile_completed?: boolean | null
          signup_reasons?: string[] | null
          assigned_role?: string | null
          is_bde?: boolean | null
          bde_status?: string | null
          bde_assigned_at?: string | null
          bde_assigned_by?: string | null
          subscription_type?: string | null
          email_opt_in?: boolean | null
          engagement_credit_earned?: boolean | null
          ai_tutor_used?: number | null
          videos_watched?: number | null
          posts_created?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: string
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          role: string
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          role?: string
          created_at?: string | null
        }
      }
      wallets: {
        Row: {
          id: string
          user_id: string
          user_wallet_balance: number | null
          gem_points: number | null
          gfe_wallet_balance: number | null
          bank_name: string | null
          bank_account_number: string | null
          bank_account_name: string | null
          bank_details_locked: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          user_wallet_balance?: number | null
          gem_points?: number | null
          gfe_wallet_balance?: number | null
          bank_name?: string | null
          bank_account_number?: string | null
          bank_account_name?: string | null
          bank_details_locked?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          user_wallet_balance?: number | null
          gem_points?: number | null
          gfe_wallet_balance?: number | null
          bank_name?: string | null
          bank_account_number?: string | null
          bank_account_name?: string | null
          bank_details_locked?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      wallet_transactions: {
        Row: {
          id: string
          wallet_id: string
          transaction_type: string
          amount: number
          narration: string | null
          source: string | null
          status: string | null
          actor_id: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          wallet_id: string
          transaction_type: string
          amount: number
          narration?: string | null
          source?: string | null
          status?: string | null
          actor_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          wallet_id?: string
          transaction_type?: string
          amount?: number
          narration?: string | null
          source?: string | null
          status?: string | null
          actor_id?: string | null
          created_at?: string | null
        }
      }
      deposit_requests: {
        Row: {
          id: string
          user_id: string
          amount: number
          payment_method: string | null
          reference_number: string | null
          bank_name: string | null
          bank_account_number: string | null
          depositor_name: string | null
          proof_of_payment_url: string | null
          status: string | null
          wallet_type: string | null
          processed_by: string | null
          processed_at: string | null
          admin_notes: string | null
          narration: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          payment_method?: string | null
          reference_number?: string | null
          bank_name?: string | null
          bank_account_number?: string | null
          depositor_name?: string | null
          proof_of_payment_url?: string | null
          status?: string | null
          wallet_type?: string | null
          processed_by?: string | null
          processed_at?: string | null
          admin_notes?: string | null
          narration?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          amount?: number
          payment_method?: string | null
          reference_number?: string | null
          bank_name?: string | null
          bank_account_number?: string | null
          depositor_name?: string | null
          proof_of_payment_url?: string | null
          status?: string | null
          wallet_type?: string | null
          processed_by?: string | null
          processed_at?: string | null
          admin_notes?: string | null
          narration?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      withdrawal_requests: {
        Row: {
          id: string
          user_id: string
          amount: number
          wallet_type: string
          status: string | null
          processed_by: string | null
          processed_at: string | null
          notes: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          wallet_type: string
          status?: string | null
          processed_by?: string | null
          processed_at?: string | null
          notes?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          amount?: number
          wallet_type?: string
          status?: string | null
          processed_by?: string | null
          processed_at?: string | null
          notes?: string | null
          created_at?: string | null
        }
      }
      posts: {
        Row: {
          id: string
          author_id: string
          category: string
          content: string
          attachment_url: string | null
          attachment_type: string | null
          is_approved: boolean | null
          is_pinned: boolean | null
          is_hidden: boolean | null
          likes_count: number | null
          comments_count: number | null
          shares_count: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          author_id: string
          category: string
          content: string
          attachment_url?: string | null
          attachment_type?: string | null
          is_approved?: boolean | null
          is_pinned?: boolean | null
          is_hidden?: boolean | null
          likes_count?: number | null
          comments_count?: number | null
          shares_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          author_id?: string
          category?: string
          content?: string
          attachment_url?: string | null
          attachment_type?: string | null
          is_approved?: boolean | null
          is_pinned?: boolean | null
          is_hidden?: boolean | null
          likes_count?: number | null
          comments_count?: number | null
          shares_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      post_likes: {
        Row: {
          id: string
          post_id: string
          user_id: string
          created_at: string | null
        }
        Insert: {
          id?: string
          post_id: string
          user_id: string
          created_at?: string | null
        }
        Update: {
          id?: string
          post_id?: string
          user_id?: string
          created_at?: string | null
        }
      }
      post_comments: {
        Row: {
          id: string
          post_id: string
          author_id: string
          content: string
          is_hidden: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          post_id: string
          author_id: string
          content: string
          is_hidden?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          post_id?: string
          author_id?: string
          content?: string
          is_hidden?: boolean | null
          created_at?: string | null
        }
      }
      post_shares: {
        Row: {
          id: string
          post_id: string
          user_id: string
          platform: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          post_id: string
          user_id: string
          platform?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          post_id?: string
          user_id?: string
          platform?: string | null
          created_at?: string | null
        }
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          message: string | null
          is_read: boolean | null
          data: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          message?: string | null
          is_read?: boolean | null
          data?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          title?: string
          message?: string | null
          is_read?: boolean | null
          data?: Json | null
          created_at?: string | null
        }
      }
      messages: {
        Row: {
          id: string
          sender_id: string
          recipient_id: string | null
          recipient_team: string | null
          subject: string | null
          content: string
          is_read: boolean | null
          parent_id: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          sender_id: string
          recipient_id?: string | null
          recipient_team?: string | null
          subject?: string | null
          content: string
          is_read?: boolean | null
          parent_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          sender_id?: string
          recipient_id?: string | null
          recipient_team?: string | null
          subject?: string | null
          content?: string
          is_read?: boolean | null
          parent_id?: string | null
          created_at?: string | null
        }
      }
      groups: {
        Row: {
          id: string
          owner_id: string
          group_name: string
          group_type: string
          logo_url: string | null
          group_email: string | null
          group_phone: string | null
          group_address: string | null
          group_size: string | null
          country: string | null
          region: string | null
          contact_person_name: string | null
          contact_person_email: string | null
          contact_person_phone: string | null
          user_tier: string | null
          is_gfe: boolean | null
          gfe_terms_agreed_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          owner_id: string
          group_name: string
          group_type: string
          logo_url?: string | null
          group_email?: string | null
          group_phone?: string | null
          group_address?: string | null
          group_size?: string | null
          country?: string | null
          region?: string | null
          contact_person_name?: string | null
          contact_person_email?: string | null
          contact_person_phone?: string | null
          user_tier?: string | null
          is_gfe?: boolean | null
          gfe_terms_agreed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          owner_id?: string
          group_name?: string
          group_type?: string
          logo_url?: string | null
          group_email?: string | null
          group_phone?: string | null
          group_address?: string | null
          group_size?: string | null
          country?: string | null
          region?: string | null
          contact_person_name?: string | null
          contact_person_email?: string | null
          contact_person_phone?: string | null
          user_tier?: string | null
          is_gfe?: boolean | null
          gfe_terms_agreed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      firms: {
        Row: {
          id: string
          owner_id: string
          firm_name: string
          sector: string | null
          country: string | null
          license_number: string | null
          license_document_url: string | null
          contact_person_name: string | null
          contact_person_title: string | null
          contact_email: string | null
          contact_phone: string | null
          contact_address: string | null
          logo_url: string | null
          description: string | null
          is_verified: boolean | null
          verified_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          owner_id: string
          firm_name: string
          sector?: string | null
          country?: string | null
          license_number?: string | null
          license_document_url?: string | null
          contact_person_name?: string | null
          contact_person_title?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contact_address?: string | null
          logo_url?: string | null
          description?: string | null
          is_verified?: boolean | null
          verified_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          owner_id?: string
          firm_name?: string
          sector?: string | null
          country?: string | null
          license_number?: string | null
          license_document_url?: string | null
          contact_person_name?: string | null
          contact_person_title?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contact_address?: string | null
          logo_url?: string | null
          description?: string | null
          is_verified?: boolean | null
          verified_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      firm_staff: {
        Row: {
          id: string
          firm_id: string
          user_id: string
          role: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          firm_id: string
          user_id: string
          role?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          firm_id?: string
          user_id?: string
          role?: string | null
          created_at?: string | null
        }
      }
      education_modules: {
        Row: {
          id: string
          title: string
          description: string | null
          content: string | null
          video_url: string | null
          tier_required: string | null
          category: string | null
          subcategory: string | null
          order_index: number | null
          is_published: boolean | null
          thumbnail_url: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          content?: string | null
          video_url?: string | null
          tier_required?: string | null
          category?: string | null
          subcategory?: string | null
          order_index?: number | null
          is_published?: boolean | null
          thumbnail_url?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          content?: string | null
          video_url?: string | null
          tier_required?: string | null
          category?: string | null
          subcategory?: string | null
          order_index?: number | null
          is_published?: boolean | null
          thumbnail_url?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      user_progress: {
        Row: {
          id: string
          user_id: string
          module_id: string
          completed: boolean | null
          quiz_score: number | null
          completed_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          module_id: string
          completed?: boolean | null
          quiz_score?: number | null
          completed_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          module_id?: string
          completed?: boolean | null
          quiz_score?: number | null
          completed_at?: string | null
          created_at?: string | null
        }
      }
      content_categories: {
        Row: {
          id: string
          name: string
          description: string | null
          is_bde_only: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          is_bde_only?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          is_bde_only?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      education_module_categories: {
        Row: {
          id: string
          module_id: string | null
          category_id: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          module_id?: string | null
          category_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          module_id?: string | null
          category_id?: string | null
          created_at?: string | null
        }
      }
      ai_search_logs: {
        Row: {
          id: string
          user_id: string | null
          search_type: string
          query: string
          result: string | null
          success: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          search_type: string
          query: string
          result?: string | null
          success?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          search_type?: string
          query?: string
          result?: string | null
          success?: boolean | null
          created_at?: string | null
        }
      }
      complaints: {
        Row: {
          id: string
          user_id: string
          issue_type: string
          description: string
          status: string | null
          assigned_team: string | null
          resolved_by: string | null
          resolved_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          issue_type: string
          description: string
          status?: string | null
          assigned_team?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          issue_type?: string
          description?: string
          status?: string | null
          assigned_team?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string | null
        }
      }
      investment_opportunities: {
        Row: {
          id: string
          firm_id: string
          title: string
          category: string
          description: string | null
          minimum_amount: number | null
          expected_roi: number | null
          duration: string | null
          payment_frequency: string | null
          risk_level: string | null
          documents_url: string[] | null
          media_url: string | null
          sdg_tags: string[] | null
          status: string | null
          admin_notes: string | null
          views_count: number | null
          likes_count: number | null
          comments_count: number | null
          shares_count: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          firm_id: string
          title: string
          category: string
          description?: string | null
          minimum_amount?: number | null
          expected_roi?: number | null
          duration?: string | null
          payment_frequency?: string | null
          risk_level?: string | null
          documents_url?: string[] | null
          media_url?: string | null
          sdg_tags?: string[] | null
          status?: string | null
          admin_notes?: string | null
          views_count?: number | null
          likes_count?: number | null
          comments_count?: number | null
          shares_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          firm_id?: string
          title?: string
          category?: string
          description?: string | null
          minimum_amount?: number | null
          expected_roi?: number | null
          duration?: string | null
          payment_frequency?: string | null
          risk_level?: string | null
          documents_url?: string[] | null
          media_url?: string | null
          sdg_tags?: string[] | null
          status?: string | null
          admin_notes?: string | null
          views_count?: number | null
          likes_count?: number | null
          comments_count?: number | null
          shares_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      user_investments: {
        Row: {
          id: string
          user_id: string
          opportunity_id: string
          amount: number
          status: string | null
          gains: number | null
          started_at: string | null
          completed_at: string | null
          cancelled_at: string | null
          cancel_reason: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          opportunity_id: string
          amount: number
          status?: string | null
          gains?: number | null
          started_at?: string | null
          completed_at?: string | null
          cancelled_at?: string | null
          cancel_reason?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          opportunity_id?: string
          amount?: number
          status?: string | null
          gains?: number | null
          started_at?: string | null
          completed_at?: string | null
          cancelled_at?: string | null
          cancel_reason?: string | null
          created_at?: string | null
        }
      }
      adverts: {
        Row: {
          id: string
          title: string
          description: string | null
          media_url: string | null
          target_audience: Json | null
          channel: string
          duration_hours: number | null
          start_at: string | null
          end_at: string | null
          status: string | null
          views_count: number | null
          clicks_count: number | null
          advertiser_id: string | null
          advertiser_name: string | null
          advertiser_email: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          media_url?: string | null
          target_audience?: Json | null
          channel: string
          duration_hours?: number | null
          start_at?: string | null
          end_at?: string | null
          status?: string | null
          views_count?: number | null
          clicks_count?: number | null
          advertiser_id?: string | null
          advertiser_name?: string | null
          advertiser_email?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          media_url?: string | null
          target_audience?: Json | null
          channel?: string
          duration_hours?: number | null
          start_at?: string | null
          end_at?: string | null
          status?: string | null
          views_count?: number | null
          clicks_count?: number | null
          advertiser_id?: string | null
          advertiser_name?: string | null
          advertiser_email?: string | null
          created_at?: string | null
        }
      }
      referral_stats: {
        Row: {
          id: string
          user_id: string
          total_clicks: number | null
          total_signups: number | null
          total_verified: number | null
          total_subscribed: number | null
          total_investing: number | null
          total_earnings: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          total_clicks?: number | null
          total_signups?: number | null
          total_verified?: number | null
          total_subscribed?: number | null
          total_investing?: number | null
          total_earnings?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          total_clicks?: number | null
          total_signups?: number | null
          total_verified?: number | null
          total_subscribed?: number | null
          total_investing?: number | null
          total_earnings?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      system_settings: {
        Row: {
          id: string
          key: string
          value: Json
          updated_by: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          key: string
          value: Json
          updated_by?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          key?: string
          value?: Json
          updated_by?: string | null
          updated_at?: string | null
        }
      }
      promo_codes: {
        Row: {
          id: string
          code: string
          campaign_name: string
          discount_percentage: number
          max_uses: number | null
          used_count: number | null
          expires_at: string | null
          is_active: boolean | null
          plan_type: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          code: string
          campaign_name: string
          discount_percentage: number
          max_uses?: number | null
          used_count?: number | null
          expires_at?: string | null
          is_active?: boolean | null
          plan_type?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          code?: string
          campaign_name?: string
          discount_percentage?: number
          max_uses?: number | null
          used_count?: number | null
          expires_at?: string | null
          is_active?: boolean | null
          plan_type?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      promo_code_uses: {
        Row: {
          id: string
          promo_code_id: string | null
          user_id: string | null
          used_at: string | null
          discount_applied: number | null
          plan_type: string | null
        }
        Insert: {
          id?: string
          promo_code_id?: string | null
          user_id?: string | null
          used_at?: string | null
          discount_applied?: number | null
          plan_type?: string | null
        }
        Update: {
          id?: string
          promo_code_id?: string | null
          user_id?: string | null
          used_at?: string | null
          discount_applied?: number | null
          plan_type?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _user_id: string
          _role: string
        }
        Returns: boolean
      }
      generate_referral_code: {
        Args: Record<string, never>
        Returns: string
      }
      process_deposit_request: {
        Args: {
          request_id: string
          admin_id: string
          action: string
        }
        Returns: boolean
      }
      generate_promo_code: {
        Args: {
          p_campaign_name: string
          p_discount_percentage: number
          p_max_uses?: number
          p_expires_at?: string
          p_plan_type?: string
          p_created_by?: string
        }
        Returns: Json
      }
      validate_promo_code: {
        Args: {
          p_code: string
          p_user_id: string
        }
        Returns: Json
      }
      activate_free_subscription: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      increment_promo_usage: {
        Args: {
          promo_id: string
        }
        Returns: void
      }
      check_engagement_credit: {
        Args: {
          p_user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: 'admin' | 'moderator' | 'user'
      user_type: 'individual' | 'group' | 'firm'
      user_tier: 'free' | 'premium'
      post_category: 'financial_tips' | 'success_stories' | 'market_news' | 'questions' | 'general' | 'scam_alerts'
      investment_status: 'pending' | 'active' | 'closed' | 'cancelled'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
