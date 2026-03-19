import { Button } from './Button'
import { Card } from './Card'
import { pug } from './helpers'

type Item = {
  title: string
}

export default function TypeScriptErrorsInPug () {
  const maybeLabel: string | undefined = 'Broken label'

  return pug`
    .errors
      Card(title=missingTitleValue)
      Button(onClick="bad", label="Broken button")
      Button(onClick=() => missingInlineHandler, label="Broken inline")

      p #{missingInterpolationValue}

      if missingConditionFlag
        Card(title="Shown")

      each item in (missingItemsSource as Item[])
        Card(title=item.title)

      Card(title=(maybeLabel as number))
  `
}
