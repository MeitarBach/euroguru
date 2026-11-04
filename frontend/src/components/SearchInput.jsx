import React, { useRef } from 'react';
import { X } from 'lucide-react';

/**
 * The app's search box: a text input with a small × in the right corner, shown once
 * something is typed, that empties it and keeps the cursor in it.
 *
 * No magnifier icon. .input-dark sets its own padding, which beat the pl-8 meant to
 * make room for one, so the icon sat on top of the placeholder's first letter. The
 * room for the × is an inline style for the same reason.
 */
export default function SearchInput({
    value, onChange, placeholder, id, inputRef,
    className = '', inputClassName = 'input-dark w-full',
}) {
    const ownRef = useRef(null);
    const ref = inputRef ?? ownRef;

    return (
        <div className={`relative ${className}`}>
            <input
                ref={ref}
                id={id}
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={inputClassName}
                style={{ paddingRight: '2rem' }}
            />
            {value && (
                <button
                    type="button"
                    onClick={() => { onChange(''); ref.current?.focus(); }}
                    aria-label="Clear search"
                    title="Clear"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                >
                    <X size={14} />
                </button>
            )}
        </div>
    );
}
