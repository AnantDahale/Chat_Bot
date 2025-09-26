from django.shortcuts import render, redirect, get_object_or_404
from django.http import StreamingHttpResponse, JsonResponse, HttpResponseRedirect
from django.urls import reverse
from .models import ChatSession, Message
import google.generativeai as genai
import os
import json
import re
from django.conf import settings

SYSTEM_PROMPT = (
    "You are Chat_MCA, a specialized AI assistant. Your purpose is to help users with topics related to coding, "
    "software development, and the Masters of Computer Application (MCA) curriculum. "
    "You were created by the developer Samay Jain. When asked who made you, you must credit him. "
    "Always provide answers that are accurate, well-structured, and helpful within your domain of expertise. "
    "If a question is outside your domain, politely state your specialization and offer to help with a relevant topic."
)
try:
    genai.configure(api_key=settings.GEMINI_API_KEY)
except Exception as e:
    print(f"Error configuring Gemini API: {e}")


def chat_view(request, session_id):
    if not request.session.session_key: request.session.save()
    session_key = request.session.session_key
    chat_session = get_object_or_404(ChatSession, id=session_id, session_key=session_key)
    user_chat_sessions = ChatSession.objects.filter(session_key=session_key)
    messages = chat_session.messages.all()
    message_history = [{"role": msg.role, "parts": [{"text": msg.content}]} for msg in messages]
    return render(request, 'myapp/chat.html', {
        'session_id': session_id,
        'message_history_json': json.dumps(message_history),
        'user_chat_sessions': user_chat_sessions,
        'current_chat_id': chat_session.id
    })

def new_chat_session(request):
    if not request.session.session_key: request.session.save()
    session_key = request.session.session_key
    chat_session = ChatSession.objects.create(session_key=session_key)
    return redirect('chat_view', session_id=chat_session.id)

def get_response(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            user_message_content, session_id, history = data.get('message'), data.get('session_id'), data.get('history', [])
            chat_session = get_object_or_404(ChatSession, id=session_id)
            Message.objects.create(session=chat_session, role='user', content=user_message_content)
            model = genai.GenerativeModel('gemini-2.5-flash', system_instruction=SYSTEM_PROMPT)
            chat = model.start_chat(history=history)
            response_stream = chat.send_message(user_message_content, stream=True)
            def stream_generator():
                full_bot_response = ""
                for chunk in response_stream:
                    if chunk.text:
                        full_bot_response += chunk.text
                        yield f"data: {json.dumps({'text': chunk.text})}\n\n"
                if full_bot_response: Message.objects.create(session=chat_session, role='model', content=full_bot_response)
            return StreamingHttpResponse(stream_generator(), content_type='text/event-stream')
        except Exception as e: return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Invalid request method'}, status=405)

def update_title(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            session_id, history = data.get('session_id'), data.get('history', [])
            chat_session = get_object_or_404(ChatSession, id=session_id)
            if history and chat_session.title == "New Chat":
                model = genai.GenerativeModel('gemini-2.5-flash')
                prompt = f"Based on this conversation, create a very short, concise title (4-5 words max).\n\nCONVERSATION:\nUser: {history[0]['parts'][0]['text']}\nModel: {history[1]['parts'][0]['text']}"
                response = model.generate_content(prompt)
                new_title = response.text.strip().replace("\"", "")
                chat_session.title = new_title
                chat_session.save()
                return JsonResponse({'title': new_title})
        except Exception as e: return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Invalid request method'}, status=405)

def get_suggestions(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            history = data.get('history', [])
            if not history: return JsonResponse({'suggestions': []})
            model = genai.GenerativeModel('gemini-2.5-flash')
            prompt = ("Suggest three short, relevant follow-up questions. Return ONLY a valid JSON array of strings.")
            full_prompt = [{"role": "user", "parts": [{"text": prompt}]}]
            response = model.generate_content(full_prompt + history)
            json_match = re.search(r'\[.*\]', response.text, re.DOTALL)
            if json_match: return JsonResponse({'suggestions': json.loads(json_match.group(0))})
            else: return JsonResponse({'suggestions': []})
        except Exception as e: return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Invalid request method'}, status=405)

def rename_chat(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            session_id = data.get('session_id')
            new_title = data.get('new_title')
            chat_session = get_object_or_404(ChatSession, id=session_id)
            chat_session.title = new_title
            chat_session.save()
            return JsonResponse({'status': 'success', 'new_title': new_title})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Invalid request'}, status=400)

def delete_chat(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            session_id = data.get('session_id')
            chat_session = get_object_or_404(ChatSession, id=session_id)
            chat_session.delete()
            return JsonResponse({'status': 'success', 'redirect_url': reverse('new_chat')})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Invalid request'}, status=400)