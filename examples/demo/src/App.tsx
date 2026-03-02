import React, { useState } from 'react';
import { Button } from './Button';
import { Card } from './Card';

// Declare the pug tag function (provided at runtime by your bundler plugin)
declare function pug(strings: TemplateStringsArray, ...values: any[]): React.ReactNode;

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

const initialTodos: Todo[] = [
  { id: 1, text: 'Try hovering over component names', done: false },
  { id: 2, text: 'Ctrl+click to go to definition', done: false },
  { id: 3, text: 'Check autocomplete on props', done: true },
];

export default function App() {
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [showCompleted, setShowCompleted] = useState(true);

  const handleToggle = (id: number) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const handleReset = () => {
    setTodos(initialTodos);
  };

  const activeTodos = todos.filter(t => !t.done);
  const completedTodos = todos.filter(t => t.done);

  // Demonstrates: typed props, event handlers, conditionals, loops, nesting
  return pug`
    .app
      Card(title="Pug React Demo", subtitle="IntelliSense for pug tagged templates")
        .toolbar
          Button(onClick=handleReset, label="Reset", variant="secondary")
          Button(onClick=() => setShowCompleted(!showCompleted), label=showCompleted ? "Hide Done" : "Show Done")

        h3 Active (#{activeTodos.length})
        if activeTodos.length === 0
          p.empty All done!
        else
          each todo in activeTodos
            .todo-item(key=todo.id)
              input(type="checkbox", checked=todo.done, onChange=() => handleToggle(todo.id))
              span= todo.text

        if showCompleted && completedTodos.length > 0
          h3 Completed (#{completedTodos.length})
          each todo in completedTodos
            .todo-item.done(key=todo.id)
              input(type="checkbox", checked=todo.done, onChange=() => handleToggle(todo.id))
              span= todo.text
  `;
}
