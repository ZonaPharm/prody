// src/components/pos/cart-reducer.ts

import { CartState, CartAction } from './cart-types'

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD': {
      const existing = state.items.find(i => i.product.id === action.product.id)
      if (existing) {
        return {
          items: state.items.map(i =>
            i.product.id === action.product.id ? { ...i, qty: i.qty + 1 } : i
          ),
        }
      }
      return { items: [...state.items, { product: action.product, qty: 1 }] }
    }

    case 'REMOVE':
      return { items: state.items.filter(i => i.product.id !== action.productId) }

    case 'SET_QTY': {
      if (action.qty <= 0) {
        return { items: state.items.filter(i => i.product.id !== action.productId) }
      }
      return {
        items: state.items.map(i =>
          i.product.id === action.productId ? { ...i, qty: action.qty } : i
        ),
      }
    }

    case 'CLEAR':
      return { items: [] }

    default:
      return state
  }
}

export const initialCartState: CartState = { items: [] }
