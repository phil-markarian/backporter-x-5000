export function getMainStyles(imageUri: string) {
    return `
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .container {
            display: flex;
            width: 100%;
            min-height: 100vh;
        }
        .left-side {
            width: 30%;
            background-color: #2B86CD;
            padding: 2.5rem;
            box-sizing: border-box;
            color: white;
        }
        .right-side {
            width: 70%;
            background-image: url('${imageUri}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
        }
        .form-group {
            margin-bottom: 1.25rem;
        }
        label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 500;
            color: rgba(255,255,255,0.9);
        }
        input, select {
            width: 90%;
            padding: 0.625rem;
            border-radius: 0.25rem;
            border: 0.0625rem solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.1);
            color: white;
            font-size: 0.875rem;
        }
        input::placeholder { color: rgba(255,255,255,0.5); }
        input:disabled {
            background: rgba(255,255,255,0.05);
            color: rgba(255,255,255,0.3);
            cursor: not-allowed;
        }
        select option {
            background: #007acc;
            color: white;
        }
        h1 {
            margin-bottom: 1.875rem;
            font-size: 1.5rem;
            font-weight: 400;
            color: white;
        }
        #submitButton {
            width: 90%;
            padding: 0.75rem 1.5rem;
            background: #CD722B;
            color: white;
            border: none;
            border-radius: 0.375rem;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            margin-top: 1.25rem;
            transition: all 0.2s ease;
            box-shadow: 0 0.125rem 0.25rem rgba(0,0,0,0.1);
            text-align: center;
            display: block;
        }
        #submitButton:hover {
            background: #35CD2B;
            box-shadow: 0 0.25rem 0.5rem rgba(0,0,0,0.2);
            transform: translateY(-0.0625rem);
        }
        #submitButton:active {
            transform: translateY(0.0625rem);
            box-shadow: 0 0.0625rem 0.125rem rgba(0,0,0,0.1);
        }
        #submitButton:disabled {
            background: #cccccc;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        .version-item {
            display: inline-block;
            margin: 0 0.625rem 0.625rem 0;
            position: relative;
        }
        .version-add {
            padding: 0.5rem 1rem;
            background: #CD722B;
            color: white;
            border: none;
            border-radius: 1.25rem;
            cursor: pointer;
            font-size: 0.8125rem;
            transition: background-color 0.2s;
            box-shadow: 0 0.125rem 0.25rem rgba(0,0,0,0.1);
        }
        .version-add:hover { background: #35CD2B; }
        .version-delete {
            position: absolute;
            top: -0.5rem;
            right: -0.5rem;
            width: 1.25rem;
            height: 1.25rem;
            background: #cc0000;
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            transition: background-color 0.2s;
            box-shadow: 0 0.125rem 0.25rem rgba(0,0,0,0.1);
            opacity: 0;
        }
        .version-item:hover .version-delete { opacity: 1; }
        .version-delete:hover { background: #aa0000; }
        label.disabled { opacity: 0.5; }
        .header-container {
            display: flex;
            flex-direction: column;
            position: relative;
            margin-bottom: 1.875rem;
            margin-top: 2.5rem;
        }

        .language-selector {
            position: absolute;
            top: -4.0625rem;
            right: -1.875rem;
        }

        .language-select {
            width: auto;
            padding: 0.5rem 0.75rem;
            border-radius: 0.25rem;
            background: rgba(255,255,255,0.1);
            color: white;
            border: 0.0625rem solid rgba(255,255,255,0.2);
            font-size: 0.875rem;
            cursor: pointer;
        }

        .language-select option {
            background: #2B86CD;
            color: white;
        }

        .language-select:hover {
            background: rgba(255,255,255,0.15);
        }

        h1 {
            margin: 0;
            font-size: 1.5rem;
            font-weight: 400;
            color: white;
        }
    `;
}

export function getPrSelectionStyles() {
    return `
        body {
            padding: 1.25rem;
            color: white;
            background-color: #2B86CD;
        }
        .pr-info { margin-bottom: 1.25rem; }
        .search-box { margin: 1.25rem 0; }
        textarea {
            width: 100%;
            margin: 0.625rem 0;
            background: rgba(255,255,255,0.1);
            color: white;
            border: 0.0625rem solid rgba(255,255,255,0.2);
        }
        button {
            background: #CD722B;
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 0.25rem;
            cursor: pointer;
        }
    `;
}