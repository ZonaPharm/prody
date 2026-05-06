import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { description, instructions } = await request.json()

    if (!description || typeof description !== 'string') {
      return NextResponse.json({ error: 'Липсва описание' }, { status: 400 })
    }

    const systemPrompt = instructions
      ? `Ти си професионален редактор на продуктови описания. Следвай тези инструкции:\n${instructions}`
      : 'Ти си професионален редактор на продуктови описания. Пренапиши описанието на добър, професионален български език. Запази цялата фактологична информация. Използвай ясни и точни изрази. Не добавяй информация, която не съществува в оригинала.'

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Пренапиши следното продуктово описание на български:\n\n${description}` },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: `AI грешка: ${response.status}` }, { status: 502 })
    }

    const data = await response.json()
    const rewritten = data.choices?.[0]?.message?.content?.trim()

    if (!rewritten) {
      return NextResponse.json({ error: 'AI не върна резултат' }, { status: 502 })
    }

    return NextResponse.json({ description: rewritten })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Грешка при пренаписване' },
      { status: 500 }
    )
  }
}
