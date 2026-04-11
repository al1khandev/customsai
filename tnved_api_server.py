#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HTTP API сервер для TN VED Classifier
Позволяет JavaScript-боту вызывать Python модуль tnved_classifier
"""

from flask import Flask, request, jsonify
from tnved_classifier import TNVEDClassifier
import sys

app = Flask(__name__)
classifier = TNVEDClassifier()

@app.route('/classify', methods=['POST'])
def classify():
    """API endpoint для классификации товара"""
    try:
        data = request.json
        description = data.get('description', '')
        
        if not description:
            return jsonify({
                'error': 'Missing description parameter'
            }), 400
        
        result = classifier.classify(description)
        
        return jsonify({
            'code': result.main_code,
            'alternative_code': result.alternative_code,
            'description': result.description,
            'rationale': result.rationale,
            'confidence': result.confidence.value,
            'clarification_questions': result.clarification_questions,
            'analysis_steps': result.analysis_steps
        })
    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    port = 5001
    print(f'🚀 TN VED API Server starting on port {port}...')
    print(f'📡 Endpoint: http://localhost:{port}/classify')
    app.run(host='0.0.0.0', port=port, debug=False)
