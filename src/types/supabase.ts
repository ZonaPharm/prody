export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          role: 'admin' | 'seller'
          display_name: string
          store_id: string | null
          created_at: string
        }
        Insert: {
          id: string
          email: string
          role?: 'admin' | 'seller'
          display_name: string
          store_id?: string | null
          created_at?: string
        }
      }
      stores: {
        Row: {
          id: string
          name: string
          address: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          address?: string | null
          is_active?: boolean
          created_at?: string
        }
      }
      categories: {
        Row: {
          id: string
          name: string
          description: string | null
          parent_id: string | null
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          parent_id?: string | null
          sort_order?: number
          created_at?: string
        }
      }
      products: {
        Row: {
          id: string
          name: string
          description: string | null
          price: number | null
          cost_price: number | null
          sku: string | null
          barcode: string | null
          category_id: string | null
          source: string | null
          source_url: string | null
          source_order_date: string | null
          status: 'ordered' | 'received' | 'damaged' | 'returned' | 'listed'
          quantity_on_hand: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          price?: number | null
          cost_price?: number | null
          sku?: string | null
          barcode?: string | null
          category_id?: string | null
          source?: string | null
          source_url?: string | null
          source_order_date?: string | null
          status?: 'ordered' | 'received' | 'damaged' | 'returned' | 'listed'
          quantity_on_hand?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          price?: number | null
          cost_price?: number | null
          sku?: string | null
          barcode?: string | null
          category_id?: string | null
          source?: string | null
          source_url?: string | null
          source_order_date?: string | null
          status?: 'ordered' | 'received' | 'damaged' | 'returned' | 'listed'
          quantity_on_hand?: number
          updated_at?: string
        }
      }
      product_images: {
        Row: {
          id: string
          product_id: string
          url: string
          is_primary: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          product_id: string
          url: string
          is_primary?: boolean
          sort_order?: number
          created_at?: string
        }
      }
      sales: {
        Row: {
          id: string
          product_id: string
          store_id: string
          sold_by: string
          quantity: number
          sale_price: number
          sale_date: string
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          product_id: string
          store_id: string
          sold_by: string
          quantity: number
          sale_price: number
          sale_date?: string
          notes?: string | null
          created_at?: string
        }
      }
    }
  }
}
