from django.urls import path
from . import views

urlpatterns = [
    path('', views.new_chat_session, name='new_chat'),
    path('chat/<uuid:session_id>/', views.chat_view, name='chat_view'),
    path('get_response/', views.get_response, name='get_response'),
    path('get_suggestions/', views.get_suggestions, name='get_suggestions'),
    path('update_title/', views.update_title, name='update_title'),
    # NEW: Endpoints for renaming and deleting chats
    path('rename_chat/', views.rename_chat, name='rename_chat'),
    path('delete_chat/', views.delete_chat, name='delete_chat'),
]