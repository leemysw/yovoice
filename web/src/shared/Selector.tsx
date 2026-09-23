import { useId, type ReactNode } from 'react';
import { Selector as AstryxSelector, type SelectorProps } from '@astryxdesign/core/Selector';
import { VStack } from '@astryxdesign/core/Layout';
import { isMac } from './lib/client';

export { SelectorOption } from '@astryxdesign/core/Selector';

function nativeOptions(options: SelectorProps['options']): ReactNode {
  return options.map((option, index) => {
    if (typeof option === 'string') return <option key={option} value={option}>{option}</option>;
    if ('type' in option) return option.type === 'section'
      ? <optgroup key={index} label={option.title ?? ''}>{nativeOptions(option.options)}</optgroup> : null;
    return <option key={option.value} value={option.value} disabled={option.disabled}>{option.label ?? option.value}</option>;
  });
}

export function Selector(props: SelectorProps) {
  const generatedId = useId();
  // macOS 14/15 的 WebKit 没有完整的锚点定位，使用系统下拉菜单，避免弹层落在左上角。
  if (!isMac || (CSS.supports('anchor-name', '--anchor') && CSS.supports('position-area', 'bottom'))) return <AstryxSelector {...props} />;
  const id = props.id ?? generatedId;
  return <VStack gap={2} className={props.className} style={{ width: props.width, ...props.style }}>
    {!props.isLabelHidden ? <label htmlFor={id}>{props.label}</label> : null}
    <select id={id} className="native-selector" aria-label={props.label} name={props.htmlName}
      aria-describedby={props.description ? `${id}-description` : undefined}
      disabled={props.isDisabled || props.isReadOnly || props.isLoading} required={props.isRequired}
      value={props.value ?? ''} onChange={event => props.onChange?.(event.target.value)}>
      {props.placeholder ? <option value="" disabled={!props.hasClear}>{props.placeholder}</option> : null}
      {nativeOptions(props.options)}
    </select>
    {props.description ? <small id={`${id}-description`}>{props.description}</small> : null}
  </VStack>;
}
