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
            padding: 40px;
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
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: rgba(255,255,255,0.9);
        }
        input, select {
            width: 90%;
            padding: 10px;
            border-radius: 4px;
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.1);
            color: white;
            font-size: 14px;
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
            margin-bottom: 30px;
            font-size: 24px;
            font-weight: 400;
            color: white;
        }
        #submitButton {
            width: 90%;
            padding: 12px 24px;
            background: #CD722B;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            margin-top: 20px;
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
            display: block;
        }
        #submitButton:hover {
            background: #35CD2B;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            transform: translateY(-1px);
        }
        #submitButton:active {
            transform: translateY(1px);
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        #submitButton:disabled {
            background: #cccccc;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        .version-item {
            display: inline-block;
            margin: 0 10px 10px 0;
            position: relative;
        }
        .version-add {
            padding: 8px 16px;
            background: #CD722B;
            color: white;
            border: none;
            border-radius: 20px;
            cursor: pointer;
            font-size: 13px;
            transition: background-color 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .version-add:hover { background: #35CD2B; }
        .version-delete {
            position: absolute;
            top: -8px;
            right: -8px;
            width: 20px;
            height: 20px;
            background: #cc0000;
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            transition: background-color 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            opacity: 0;
        }
        .version-item:hover .version-delete { opacity: 1; }
        .version-delete:hover { background: #aa0000; }
        label.disabled { opacity: 0.5; }
    `;
}

export function getPrSelectionStyles() {
    return `
        body {
            padding: 20px;
            color: white;
            background-color: #2B86CD;
        }
        .pr-info { margin-bottom: 20px; }
        .search-box { margin: 20px 0; }
        textarea {
            width: 100%;
            margin: 10px 0;
            background: rgba(255,255,255,0.1);
            color: white;
            border: 1px solid rgba(255,255,255,0.2);
        }
        button {
            background: #CD722B;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        }
    `;
}