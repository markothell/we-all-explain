'use client';

import { useState, useEffect, useRef } from 'react';
import { WeAllExplainActivity, Rating, Comment } from '@/models/Activity';
import { ActivityService } from '@/services/activityService';
import { webSocketService } from '@/services/websocketService';
import { ValidationService } from '@/utils/validation';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import MappingGrid from './MappingGrid';
import CommentSection from './CommentSection';
import ResultsView from './ResultsView';

interface ActivityPageProps {
  activityId: string;
}

export default function ActivityPage({ activityId }: ActivityPageProps) {
  const [activity, setActivity] = useState<WeAllExplainActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // User state
  const [userId, setUserId] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [userRating, setUserRating] = useState<Rating | null>(null);
  const [userComment, setUserComment] = useState<Comment | null>(null);
  // const [hasSubmitted, setHasSubmitted] = useState(false);
  
  // Ref for results section
  const resultsRef = useRef<HTMLDivElement>(null);
  
  // Current screen for mobile navigation
  const [currentScreen, setCurrentScreen] = useState(0);
  
  // Navigation functions
  const navigateToScreen = (screenIndex: number) => {
    const screens = ['', 'mapping-screen', 'comment-screen', 'results-screen'];
    const targetId = screens[screenIndex];
    
    if (targetId) {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setCurrentScreen(screenIndex);
  };
  
  // Swipe gesture setup
  const swipeRef = useSwipeGesture({
    onSwipeUp: () => {
      if (currentScreen < 3) {
        navigateToScreen(currentScreen + 1);
      }
    },
    onSwipeDown: () => {
      if (currentScreen > 0) {
        navigateToScreen(currentScreen - 1);
      }
    },
    minDistance: 50,
    maxTime: 300
  });

  // Initialize user session
  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    const storedUsername = localStorage.getItem('username');
    
    if (storedUserId && storedUsername) {
      setUserId(storedUserId);
      setUsername(storedUsername);
    } else {
      // Generate new user session
      const newUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newUsername = ValidationService.generateRandomUsername();
      
      localStorage.setItem('userId', newUserId);
      localStorage.setItem('username', newUsername);
      
      setUserId(newUserId);
      setUsername(newUsername);
    }
  }, []);

  // Load activity data
  useEffect(() => {
    const loadActivity = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const activityData = await ActivityService.getActivity(activityId);
        setActivity(activityData);
        
        // Check if user has already submitted
        const existingRating = activityData.ratings.find(r => r.userId === userId);
        const existingComment = activityData.comments.find(c => c.userId === userId);
        
        if (existingRating) {
          setUserRating(existingRating);
        }
        if (existingComment) {
          setUserComment(existingComment);
        }
        
        // setHasSubmitted(!!existingRating || !!existingComment);
      } catch (err) {
        setError('Failed to load activity. Please try again.');
        console.error('Error loading activity:', err);
      } finally {
        setLoading(false);
      }
    };

    if (activityId && userId) {
      loadActivity();
    }
  }, [activityId, userId]);

  // Initialize WebSocket connection
  useEffect(() => {
    const initializeWebSocket = async () => {
      if (!activityId || !userId || !username) return;

      try {
        setIsReconnecting(true);
        await webSocketService.connect(activityId, userId, username);
        setIsConnected(true);
        
        // Join activity as participant
        await ActivityService.joinActivity(activityId, userId, username);
      } catch (err) {
        console.error('WebSocket connection failed:', err);
        setIsConnected(false);
      } finally {
        setIsReconnecting(false);
      }
    };

    initializeWebSocket();

    return () => {
      webSocketService.disconnect();
    };
  }, [activityId, userId, username]);

  // Set up WebSocket event listeners
  useEffect(() => {
    // Rating events
    webSocketService.on('rating_added', ({ rating }) => {
      setActivity(prev => {
        if (!prev) return null;
        
        const updatedRatings = prev.ratings.filter(r => r.userId !== rating.userId);
        updatedRatings.push(rating);
        
        return {
          ...prev,
          ratings: updatedRatings
        };
      });
      
      if (rating.userId === userId) {
        setUserRating(rating);
      }
    });

    // Comment events
    webSocketService.on('comment_added', ({ comment }) => {
      setActivity(prev => {
        if (!prev) return null;
        
        // Check if comment already exists (avoid duplicates)
        const existingCommentIndex = prev.comments.findIndex(c => 
          c.userId === comment.userId && c.text === comment.text
        );
        
        if (existingCommentIndex >= 0) {
          // Update existing comment
          const updatedComments = [...prev.comments];
          updatedComments[existingCommentIndex] = comment;
          return {
            ...prev,
            comments: updatedComments
          };
        } else {
          // Add new comment (replacing any old comment from same user)
          const updatedComments = prev.comments.filter(c => c.userId !== comment.userId);
          updatedComments.push(comment);
          return {
            ...prev,
            comments: updatedComments
          };
        }
      });
      
      if (comment.userId === userId) {
        setUserComment(comment);
      }
    });

    // Comment vote events
    webSocketService.on('comment_voted', ({ comment }) => {
      setActivity(prev => {
        if (!prev) return prev;
        
        // Update the comment with new vote count
        const updatedComments = prev.comments.map(c => 
          c.id === comment.id ? comment : c
        );
        
        return {
          ...prev,
          comments: updatedComments
        };
      });
    });

    // Participant events
    webSocketService.on('participant_joined', ({ participant }) => {
      setActivity(prev => {
        if (!prev) return null;
        
        const updatedParticipants = prev.participants.filter(p => p.id !== participant.id);
        updatedParticipants.push(participant);
        
        return {
          ...prev,
          participants: updatedParticipants
        };
      });
    });

    webSocketService.on('participant_left', ({ participantId }) => {
      setActivity(prev => {
        if (!prev) return null;
        
        return {
          ...prev,
          participants: prev.participants.filter(p => p.id !== participantId)
        };
      });
    });

    return () => {
      webSocketService.off('rating_added');
      webSocketService.off('comment_added');
      webSocketService.off('comment_voted');
      webSocketService.off('participant_joined');
      webSocketService.off('participant_left');
    };
  }, [userId]);

  // Handle rating submission
  const handleRatingSubmit = async (position: { x: number; y: number }) => {
    if (!activity || !userId || !username) return;

    try {
      // Submit via API only - WebSocket will broadcast the result
      await ActivityService.submitRating(activity.id, userId, position);
      
    } catch (err) {
      console.error('Error submitting rating:', err);
      // Continue - WebSocket might still work
    }
  };

  // Handle comment submission
  const handleCommentSubmit = async (text: string) => {
    if (!activity || !userId || !username || isSubmitting) return;

    setIsSubmitting(true);
    
    try {
      // Submit via API only - WebSocket will broadcast the result
      await ActivityService.submitComment(activity.id, userId, text);
      
      // setHasSubmitted(true);
    } catch (err) {
      console.error('Error submitting comment:', err);
      // Handle error - could show toast notification
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle comment voting
  const handleCommentVote = async (commentId: string) => {
    if (!activity || !userId) return;
    
    try {
      await ActivityService.voteComment(activity.id, commentId, userId);
    } catch (err) {
      console.error('Error voting on comment:', err);
    }
  };

  // Handle results toggle
  const handleResultsToggle = () => {
    setShowResults(!showResults);
    
    // Scroll to results section if showing results
    if (!showResults && resultsRef.current) {
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ 
          behavior: 'smooth',
          block: 'start'
        });
      }, 100);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white">Loading activity...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Error</h2>
          <p className="text-gray-300 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Activity not found
  if (!activity) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Activity Not Found</h2>
          <p className="text-gray-600">The activity you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Scroll Container with Swipe Support */}
      <div ref={swipeRef} className="relative touch-pan-y">
        {/* Screen 1: Activity Title */}
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-white relative px-4">
          <div className="text-center z-10 max-w-4xl">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 sm:mb-8 text-white">
              <a href="/" className="hover:text-gray-300 transition-colors">
                We All Explain
              </a>
            </h1>
            <div className="bg-gradient-to-r from-purple-600 to-pink-600 px-6 sm:px-8 lg:px-12 py-4 sm:py-6 rounded-full shadow-lg mb-6 sm:mb-8">
              <h2 className="text-xl sm:text-2xl lg:text-3xl font-semibold text-white">
                {activity.title}
              </h2>
            </div>
            
            {/* Completed Activity Notice */}
            {activity.status === 'completed' && (
              <div className="bg-yellow-900 border border-yellow-700 rounded-lg px-4 py-3 mb-6 sm:mb-8">
                <p className="text-yellow-200 text-center">
                  This activity is closed.<br />Click below to view completed map.
                </p>
              </div>
            )}
            
            {/* Navigation Arrow */}
            <button 
              onClick={() => activity.status === 'completed' ? navigateToScreen(3) : navigateToScreen(1)}
              className="text-white hover:text-gray-300 transition-colors"
            >
              <img 
                src="/nextArrows.svg" 
                alt="Next" 
                className="w-24 h-24"
              />
            </button>
          </div>
        </div>

        {/* Screen 2: Mapping */}
        <div id="mapping-screen" className="min-h-screen flex flex-col bg-gradient-to-br from-slate-800 to-slate-900 text-white relative">
          {/* Top Left Logo */}
          <div className="absolute top-4 sm:top-8 left-4 sm:left-8 z-10">
            <h1 className="text-xl sm:text-2xl font-bold text-white">
              <a href="/" className="hover:text-gray-300 transition-colors">
                We All Explain
              </a>
            </h1>
          </div>
          
          <div className="flex flex-col items-center justify-start flex-1 w-full max-w-4xl mx-auto px-4 pt-16 sm:pt-20">
            <div className="text-left mb-4" style={{ width: 'min(500px, 90vw)' }}>
              <p className="text-base sm:text-lg text-gray-300 mb-2">Step 1: Click to place yourself on the map</p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-white mb-4">
                {activity.mapQuestion}
              </h2>
            </div>
            
            <div className="bg-transparent">
              <MappingGrid
                activity={activity}
                onRatingSubmit={activity.status === 'completed' ? () => {} : handleRatingSubmit}
                userRating={userRating || undefined}
                showAllRatings={false}
              />
            </div>
          </div>
          
          {/* Navigation Arrow */}
          <button 
            onClick={() => navigateToScreen(2)}
            className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-white hover:text-gray-300 transition-colors"
          >
            <div className="flex flex-col items-center">
              <img 
                src="/nextArrows.svg" 
                alt="Next" 
                className="w-24 h-24"
              />
            </div>
          </button>
        </div>

        {/* Screen 3: Comment */}
        <div id="comment-screen" className="min-h-screen flex flex-col bg-gradient-to-br from-slate-800 to-slate-900 text-white relative">
          {/* Top Left Logo */}
          <div className="absolute top-4 sm:top-8 left-4 sm:left-8 z-10">
            <h1 className="text-xl sm:text-2xl font-bold text-white">
              <a href="/" className="hover:text-gray-300 transition-colors">
                We All Explain
              </a>
            </h1>
          </div>
          
          <div className="flex flex-col items-center justify-start flex-1 w-full max-w-4xl mx-auto px-4 pt-20 sm:pt-24">
            <div className="text-left mb-6 sm:mb-8">
              <p className="text-base sm:text-lg text-gray-300 mb-2">Step 2: Answer the question:</p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-white mb-6 sm:mb-8">
                {activity.commentQuestion}
              </h2>
            </div>
            
            <div className="bg-slate-600 rounded-lg shadow-lg p-4 sm:p-6 lg:p-8 w-full max-w-[600px]">
              <CommentSection
                activity={activity}
                onCommentSubmit={activity.status === 'completed' ? () => {} : handleCommentSubmit}
                userComment={userComment || undefined}
                showAllComments={false}
                readOnly={activity.status === 'completed'}
              />
            </div>
          </div>
          
          {/* Navigation to Results */}
          <button 
            onClick={() => navigateToScreen(3)}
            className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-white hover:text-gray-300 transition-colors"
          >
            <div className="flex flex-col items-center">
              <img 
                src="/nextArrows.svg" 
                alt="Next" 
                className="w-24 h-24"
              />
            </div>
          </button>
        </div>

        {/* Screen 4: Results */}
        <div id="results-screen" className="min-h-screen bg-gradient-to-br from-slate-800 to-slate-900 relative">
          {/* Top Left Logo */}
          <div className="absolute top-4 sm:top-8 left-4 sm:left-8 z-10">
            <h1 className="text-xl sm:text-2xl font-bold text-white">
              <a href="/" className="hover:text-gray-300 transition-colors">
                We All Explain
              </a> <span className="text-pink-600">{activity?.title}</span>
            </h1>
          </div>
          
          <div className="container mx-auto px-4 py-8 pt-16 sm:pt-20">
            <div ref={resultsRef}>
              <ResultsView
                activity={activity}
                isVisible={true}
                onToggle={handleResultsToggle}
                onCommentVote={activity.status === 'completed' ? undefined : handleCommentVote}
                currentUserId={userId}
              />
            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
}