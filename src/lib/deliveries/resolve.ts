/**
 * The decisions an admin can take on a signal, per step, with what each one
 * does. resolve_signal in the database applies the stock part ("Намерено" on a
 * store signal puts the units back).
 */

export type Resolution = 'corrected' | 'returned_to_supplier' | 'found' | 'other'

export type ResolutionOption = { value: Resolution; label: string; effect: string }

export function resolutionOptions(step: string): ResolutionOption[] {
  const other: ResolutionOption = { value: 'other', label: 'Друго', effect: 'Нищо не се променя в наличността. Напишете какво е решено.' }
  switch (step) {
    case 'receive':
      return [
        { value: 'returned_to_supplier', label: 'Няма да дойде', effect: 'Липсващото по реда не се чака повече (връща се или не е изпратено от доставчика). Доставката може да приключи.' },
        { value: 'corrected', label: 'Оправено', effect: 'Нищо не се променя в наличността. Например доставчикът ще донесе липсващото и то ще се получи по реда.' },
        other,
      ]
    case 'store_receive':
      return [
        { value: 'found', label: 'Намерено в обекта', effect: 'Извадените при приемането бройки се връщат в наличността на обекта.' },
        { value: 'corrected', label: 'Липсата се потвърждава', effect: 'Бройките остават извадени от наличността на обекта (отписани).' },
        other,
      ]
    default:
      return [
        { value: 'found', label: 'Намерено', effect: 'Стоката е открита. Нищо не се променя в наличността.' },
        { value: 'corrected', label: 'Оправено', effect: 'Проблемът е отстранен (нов етикет, преопаковане). Нищо не се променя в наличността.' },
        other,
      ]
  }
}

export function resolveError(resolution: Resolution | null, note: string): string | null {
  if (!resolution) return 'Изберете решение'
  if (resolution === 'other' && note.trim().length < 3) return 'Напишете какво е решено'
  return null
}
