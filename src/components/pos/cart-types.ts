// src/components/pos/cart-types.ts

export type Product = {
  id: string
  name: string
  price: number | null
  quantity_on_hand: number
  image_url?: string | null
  category_id: string | null
}

export type CartItem = {
  product: Product
  qty: number
}

export type CartState = {
  items: CartItem[]
}

export type CartAction =
  | { type: 'ADD'; product: Product }
  | { type: 'REMOVE'; productId: string }
  | { type: 'SET_QTY'; productId: string; qty: number }
  | { type: 'CLEAR' }
