import { type ButtonHTMLAttributes, forwardRef } from 'react';

/**
 * Every button in the app, so hover, disabled and focus behave the same.
 *   primary   filled accent (the main action: Sign in, Approve selected)
 *   secondary outlined; fills with the accent on hover (Approve, Confirm transfer)
 *   link      text only (minor actions)
 *   icon      a bare symbol like ×; give it an aria-label
 * size="small" for buttons inside table rows. Takes a ref (e.g. to anchor a popover).
 */
const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'link' | 'icon';
    size?: 'small';
  }
>(function Button({ variant = 'secondary', size, type = 'button', className, ...props }, ref) {
  const classes = ['btn', `btn-${variant}`, size && `btn-${size}`, className].filter(Boolean).join(' ');
  return <button ref={ref} type={type} className={classes} {...props} />;
});

export default Button;
