import type { ButtonHTMLAttributes } from 'react';

/**
 * Every button in the app, so hover, disabled and focus behave the same.
 *   primary   filled accent (the main action: Sign in, Approve selected)
 *   secondary outlined; fills with the accent on hover (Approve, Confirm transfer)
 *   link      text only (minor actions)
 *   icon      a bare symbol like ×; give it an aria-label
 * size="small" for buttons inside table rows.
 */
export default function Button({
  variant = 'secondary',
  size,
  type = 'button',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'link' | 'icon';
  size?: 'small';
}) {
  const classes = ['btn', `btn-${variant}`, size && `btn-${size}`, className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...props} />;
}
