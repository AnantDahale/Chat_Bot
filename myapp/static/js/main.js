document.addEventListener('DOMContentLoaded', function() {
    // --- Global State ---
    const sessionData = JSON.parse(document.getElementById('session-data').textContent);
    const sessionId = sessionData.session_id;
    let conversationHistory = sessionData.history;
    let currentTitle = sessionData.title;
    let abortController = new AbortController();

    // --- DOM Elements ---
    const chatForm = document.getElementById('chat-form');
    const userInput = document.getElementById('user-input');
    const chatBox = document.getElementById('chat-box');
    const historyLinksContainer = document.getElementById('history-links');
    const stopBtnContainer = document.getElementById('stop-generating-container');
    const stopBtn = document.getElementById('stop-btn');
    const suggestionsPlaceholder = document.getElementById('suggestions-placeholder');
    const csrfToken = document.querySelector('input[name=csrfmiddlewaretoken]').value;

    // --- Event Listeners ---
    chatForm.addEventListener('submit', handleFormSubmit);
    if (stopBtn) {
        stopBtn.addEventListener('click', () => abortController.abort());
    }

    // THIS IS THE CRUCIAL PART THAT MAKES THE BUTTONS WORK
    historyLinksContainer.addEventListener('click', function(event) {
        const target = event.target.closest('.action-btn');
        if (!target) return; // Exit if the click wasn't on an action button

        const historyItem = target.closest('.history-item');
        const targetSessionId = historyItem.dataset.sessionId;

        if (target.classList.contains('rename-btn')) {
            renameChat(targetSessionId, historyItem);
        } else if (target.classList.contains('delete-btn')) {
            deleteChat(targetSessionId, historyItem);
        }
    });

    // --- Main Functions ---
    async function handleFormSubmit(event) {
        event.preventDefault();
        const userMessage = userInput.value.trim();
        if (!userMessage) return;

        abortController = new AbortController();
        suggestionsPlaceholder.innerHTML = ''; 

        appendMessage(userMessage, 'user-message', false);
        conversationHistory.push({ "role": "user", "parts": [{ "text": userMessage }] });
        userInput.value = '';
        toggleStopButton(true);

        const botMessageContainer = createMessageContainer('bot-message', true);
        botMessageContainer.querySelector('.message-content').innerHTML = '<div class="thinking-animation"></div>';
        chatBox.appendChild(botMessageContainer);
        scrollToBottom();

        let fullBotResponse = "";

        try {
            const response = await fetch('/get_response/', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                signal: abortController.signal,
                body: JSON.stringify({ 'message': userMessage, 'session_id': sessionId, 'history': conversationHistory.slice(0, -1) })
            });
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let isFirstChunk = true;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                if (isFirstChunk) {
                    botMessageContainer.querySelector('.message-content').innerHTML = '<p></p>';
                    isFirstChunk = false;
                }
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const data = JSON.parse(line.substring(5));
                        fullBotResponse += data.text;
                        botMessageContainer.querySelector('p').innerHTML = marked.parse(fullBotResponse);
                        scrollToBottom();
                    }
                }
            }
            highlightAllCode();

        } catch (error) {
            botMessageContainer.remove();
            if (error.name !== 'AbortError') {
                console.error("Error fetching stream:", error);
                appendMessage("Sorry, an error occurred.", 'bot-message', false);
            }
        } finally {
            if (fullBotResponse) {
               conversationHistory.push({ "role": "model", "parts": [{ "text": fullBotResponse }] });
               addCopyButton(botMessageContainer, fullBotResponse);
               fetchSuggestions();
               if (currentTitle === 'New Chat' && conversationHistory.length >= 2) {
                   updateTitle();
               }
            } else {
               if (!abortController.signal.aborted) botMessageContainer.remove();
            }
            toggleStopButton(false);
        }
    }

    async function renameChat(targetSessionId, historyItem) {
        const link = historyItem.querySelector('.history-link');
        const currentTitle = link.textContent.trim();
        const newTitle = prompt("Enter a new name for this chat:", currentTitle);

        if (newTitle && newTitle.trim() && newTitle.trim() !== currentTitle) {
            try {
                const response = await fetch('/rename_chat/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                    body: JSON.stringify({ session_id: targetSessionId, new_title: newTitle.trim() })
                });
                const data = await response.json();
                if (data.status === 'success') {
                    link.textContent = data.new_title;
                } else {
                    alert('Error renaming chat.');
                }
            } catch (error) {
                console.error('Rename failed:', error);
            }
        }
    }

    async function deleteChat(targetSessionId, historyItem) {
        if (confirm("Are you sure you want to delete this chat?")) {
            try {
                const response = await fetch('/delete_chat/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                    body: JSON.stringify({ session_id: targetSessionId })
                });
                const data = await response.json();
                if (data.status === 'success') {
                    if (targetSessionId === sessionId) {
                        window.location.href = data.redirect_url;
                    } else {
                        historyItem.remove();
                    }
                } else {
                    alert('Error deleting chat.');
                }
            } catch (error) {
                console.error('Delete failed:', error);
            }
        }
    }

    async function updateTitle() {
        try {
            const response = await fetch('/update_title/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                body: JSON.stringify({ session_id: sessionId, history: conversationHistory })
            });
            const data = await response.json();
            if (data.title) {
                document.getElementById(`history-link-${sessionId}`).textContent = data.title;
                currentTitle = data.title;
            }
        } catch (error) { console.error('Error updating title:', error); }
    }

    function loadInitialHistory() {
        if (conversationHistory.length === 0) {
            appendMessage( "Hello! I'm ChatMCA. How can I assist you today?", 'bot-message', false);
        } else {
            conversationHistory.forEach(turn => {
                const roleClass = turn.role === 'user' ? 'user-message' : 'bot-message';
                appendMessage(turn.parts[0].text, roleClass, turn.role === 'model');
            });
        }
        highlightAllCode();
    }
    
    async function fetchSuggestions() {
        try {
            const response = await fetch('/get_suggestions/', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                body: JSON.stringify({ 'history': conversationHistory })
            });
            const data = await response.json();
            if (data.suggestions && data.suggestions.length > 0) {
                const container = document.createElement('div');
                container.className = 'suggestions-container';
                data.suggestions.slice(0, 3).forEach(text => {
                    const btn = document.createElement('button');
                    btn.className = 'suggestion-btn';
                    btn.textContent = text;
                    btn.onclick = () => {
                        userInput.value = text;
                        chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
                    };
                    container.appendChild(btn);
                });
                suggestionsPlaceholder.appendChild(container);
            }
        } catch (error) {
            console.error('Error fetching suggestions:', error);
        }
    }

    function appendMessage(text, className, addCopyBtn) {
        const messageContainer = createMessageContainer(className);
        const contentDiv = messageContainer.querySelector('.message-content');
        contentDiv.innerHTML = marked.parse(text);
        if (addCopyBtn) {
            addCopyButton(messageContainer, text);
        }
        chatBox.appendChild(messageContainer);
        scrollToBottom();
    }

    function createMessageContainer(className) {
        const div = document.createElement('div');
        div.className = `message ${className}`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = '<p></p>';
        div.appendChild(contentDiv);
        return div;
    }

    function addCopyButton(container, textToCopy) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-clipboard" viewBox="0 0 16 16"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1z"/><path d="M10.854 7.146a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7.5 9.793l2.646-2.647a.5.5 0 0 1 .708 0"/></svg>';
        const checkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check2" viewBox="0 0 16 16"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/></svg>';
        copyBtn.innerHTML = copyIcon;
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(textToCopy);
            copyBtn.innerHTML = checkIcon;
            setTimeout(() => { copyBtn.innerHTML = copyIcon; }, 1500);
        };
        container.appendChild(copyBtn);
    }
    
    function scrollToBottom() { chatBox.scrollTop = chatBox.scrollHeight; }
    
    function toggleStopButton(show) {
        if (stopBtnContainer) {
             stopBtnContainer.style.display = show ? 'flex' : 'none';
        }
        userInput.disabled = show;
        chatForm.querySelector('button').disabled = show;
    }
    
    function highlightAllCode() {
        document.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }
});