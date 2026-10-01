/* eslint-disable react-refresh/only-export-components */
import { cloneElement, createElement, isValidElement, useEffect, useId, useRef, useState } from 'react'

function classes(...values) {
  return values.filter(Boolean).join(' ')
}

export function Button({ asChild = false, className, mode = 'primary', appearance, size = 'medium', children, ...props }) {
  const buttonClass = classes('ui-button', `ui-button--${mode}`, `ui-button--${size}`, appearance && `ui-button--${appearance}`, className)
  if (asChild && isValidElement(children)) {
    return cloneElement(children, { ...props, className: classes(buttonClass, children.props.className) })
  }
  return <button {...props} className={buttonClass}>{children}</button>
}

export function Container({ fullWidth = false, className, children, ...props }) {
  return <div {...props} className={classes('ui-container', fullWidth && 'ui-container--full', className)}>{children}</div>
}

export function Flex({ direction = 'row', gap, align, justify, wrap, className, children, style, ...props }) {
  return <div {...props} className={classes('ui-flex', className)} style={{ flexDirection: direction, gap, alignItems: align, justifyContent: justify, flexWrap: wrap, ...style }}>{children}</div>
}

export function Grid({ cols, gap, className, children, style, ...props }) {
  return <div {...props} className={classes('ui-grid', className)} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, ...style }}>{children}</div>
}

export function Panel({ className, children, ...props }) {
  return <div {...props} className={classes('ui-panel', className)}>{children}</div>
}

export function Select({ value, onChange, options, ariaLabel, placeholder = 'Выберите', className }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef(null)
  const optionRefs = useRef([])
  const listboxId = useId()
  const normalizedOptions = options.map(option => Array.isArray(option)
    ? { value: option[0], label: option[1] }
    : option)
  const selectedIndex = normalizedOptions.findIndex(option => option.value === value)
  const selectedOption = normalizedOptions[selectedIndex]

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [])

  useEffect(() => {
    if (!open) return
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(nextIndex)
  }, [open, selectedIndex])

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  function select(option) {
    onChange?.(option.value)
    setOpen(false)
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return setOpen(true)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex(index => (index + direction + normalizedOptions.length) % normalizedOptions.length)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(event.key === 'Home' ? 0 : normalizedOptions.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) return setOpen(true)
      if (normalizedOptions[activeIndex]) select(normalizedOptions[activeIndex])
    }
  }

  return (
    <div ref={rootRef} className={classes('ui-select', open && 'is-open', className)}>
      <button
        type="button"
        className="ui-select__trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        onClick={() => setOpen(current => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className={!selectedOption ? 'is-placeholder' : ''}>{selectedOption?.label ?? placeholder}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
      </button>
      {open && (
        <ul id={listboxId} className="ui-select__menu" role="listbox" aria-label={ariaLabel}>
          {normalizedOptions.map((option, index) => (
            <li
              id={`${listboxId}-${index}`}
              key={option.value}
              ref={element => { optionRefs.current[index] = element }}
              role="option"
              aria-selected={option.value === value}
              className={classes('ui-select__option', index === activeIndex && 'is-active')}
              onPointerEnter={() => setActiveIndex(index)}
              onPointerDown={event => event.preventDefault()}
              onClick={() => select(option)}
            >
              <span>{option.label}</span>
              {option.value === value && <b aria-hidden="true">✓</b>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Text({ asChild = false, as: Tag = 'div', className, children, ...props }) {
  if (asChild && isValidElement(children)) {
    return cloneElement(children, { ...props, className: classes(className, children.props.className) })
  }
  return createElement(Tag, { ...props, className }, children)
}

export const Typography = {
  Title: props => <Text as="h2" {...props} />,
  Body: props => <Text as="p" {...props} />,
  Label: props => <Text as="span" {...props} />
}
