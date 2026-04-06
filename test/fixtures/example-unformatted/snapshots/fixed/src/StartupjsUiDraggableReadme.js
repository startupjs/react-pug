import { pug } from 'startupjs'

const DragDropProvider = 'DragDropProvider'
const Droppable = 'Droppable'
const Draggable = 'Draggable'
const Span = 'Span'

export function DragDropProviderSandbox ({ children, ...props }) {
  return pug`
    DragDropProvider(...props)
      if children
        = children
      else
        Droppable(dropId='sandbox-drop')
          Draggable(dragId='sandbox-drag')
            Span Drag me
  `
}
