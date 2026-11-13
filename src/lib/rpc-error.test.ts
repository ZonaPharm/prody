import { describe, expect, it } from 'vitest'
import { rpcErrorResponse } from './rpc-error'

const FALLBACK = 'Грешка при трансфер'

describe('rpcErrorResponse', () => {
  it('passes a raised Bulgarian rule violation to the user as 400', () => {
    expect(rpcErrorResponse(
      { code: 'P0001', message: 'Недостатъчна наличност за "Аспирин": налични 3, искани 5' },
      FALLBACK,
    )).toEqual({ status: 400, error: 'Недостатъчна наличност за "Аспирин": налични 3, искани 5' })
  })

  it('treats any plain RAISE (P0001) as the caller\'s error, even in English', () => {
    expect(rpcErrorResponse({ code: 'P0001', message: 'quantity must be positive, got 0' }, FALLBACK))
      .toEqual({ status: 400, error: 'quantity must be positive, got 0' })
  })

  it('treats a Bulgarian message raised with its own ERRCODE as 400', () => {
    expect(rpcErrorResponse({ code: '23514', message: 'Обектът източник и целевият обект са един и същ' }, FALLBACK))
      .toEqual({ status: 400, error: 'Обектът източник и целевият обект са един и същ' })
  })

  it('answers 500 for a missing function', () => {
    const r = rpcErrorResponse({
      code: 'PGRST202',
      message: 'Could not find the function public.transfer_stock(...) in the schema cache',
    }, FALLBACK)
    expect(r.status).toBe(500)
  })

  it('answers 500 for a malformed uuid', () => {
    expect(rpcErrorResponse({ code: '22P02', message: 'invalid input syntax for type uuid: "x"' }, FALLBACK).status)
      .toBe(500)
  })

  it('falls back to the generic message when there is none', () => {
    expect(rpcErrorResponse({ code: '', message: '' }, FALLBACK)).toEqual({ status: 500, error: FALLBACK })
    expect(rpcErrorResponse(null, FALLBACK)).toEqual({ status: 500, error: FALLBACK })
  })
})
